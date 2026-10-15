// @vitest-environment node
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import nodePath from 'node:path'
import {fileURLToPath} from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { afterAll,afterEach,beforeAll,describe,expect,it,vi } from 'vitest'
import { parseSpaceverseRuntimeManifest } from '../../../spaceverse-runtime-manifest.js'
import {createRuntimeRelease} from '../../../spaceverse-runtime-release.js'

const state=vi.hoisted(()=>({db:null as PGlite|null,failAudit:false,targets:new Map<string,PGlite>()}))
const nativeFetch=globalThis.fetch
vi.mock('../db.js',()=>{
  const query=async(text:string,params?:unknown[])=>{
    if(state.failAudit&&text.startsWith('INSERT INTO admin_audit_log')) throw new Error('Synthetic sensitive database details')
    const r=await state.db!.query(text,params)
    return {...r,rowCount:r.rows.length||r.affectedRows||0}
  }
  const adapter={query,connect:async()=>({query,release(){}})}
  return {pool:adapter,readPool:adapter,writePool:null,tableExists:async()=>false,productionTableExists:async()=>false}
})
vi.mock('../onboarding-database-registry.js',()=>{
  const database=(db:PGlite)=>{
    const query=async(text:string,params?:unknown[])=>{
      const result=await db.query(text,params)
      return {...result,rowCount:result.rows.length||result.affectedRows||0}
    }
    return {connect:async()=>({query,release(){}})}
  }
  const onboardingTargetRegistry={
    validate:()=>({registered:state.targets.size}),
    resolveTargetDatabase:async(runtimeKey:string)=>{
      const target=state.targets.get(runtimeKey)
      return target?database(target):null
    },
    close:async()=>undefined,
  }
  return {onboardingTargetRegistry,validateOnboardingTargetRegistry:onboardingTargetRegistry.validate,
    closeOnboardingTargetRegistry:onboardingTargetRegistry.close}
})

describe('onboarding drafts: actual signed session, HTTP router and migration SQL',()=>{
  let server:http.Server,origin='',config:typeof import('../config.js').config
  const sessions=new Map<string,{cookie:string;csrf:string}>()
  const data={companyId:null,companyName:'Бар в Мулино',venueName:'Бар в Мулино',address:'Мулино',timeZone:'Europe/Moscow',venueType:'bar',ownerEmail:'owner@client.invalid'}
  const appConfig={displayName:'Бар в Мулино',theme:'premium-dark',primaryColor:'#73bcd9',secondaryColor:'#172c36',shopEnabled:true,loyaltyEnabled:true}
  const command=()=>({requestKey:crypto.randomUUID(),data})

  beforeAll(async()=>{
    process.env.ADMIN_ENABLE_WRITES='true'
    process.env.ADMIN_ENABLE_ONBOARDING_DRAFTS='true'
    process.env.ADMIN_ENABLE_ONBOARDING_INTEGRATIONS='true'
    process.env.ADMIN_ENABLE_ONBOARDING_PROVISIONING='true'
    process.env.ADMIN_ONBOARDING_SECRET_ACTIVE_KEY_ID='fixture-v1'
    process.env.ADMIN_ONBOARDING_SECRET_KEYRING=JSON.stringify({'fixture-v1':Buffer.alloc(32,7).toString('base64')})
    process.env.ADMIN_ENABLE_ONBOARDING_INVITATIONS='false'
    process.env.ADMIN_PUBLIC_ORIGIN='https://onboarding.fixture.invalid'
    process.env.ADMIN_CSRF_SECRET='synthetic-onboarding-secret-123456789012345'
    const {onboardingFixture,fixturePassword}=await import('./onboarding-fixture.js')
    state.db=await onboardingFixture()
    config=(await import('../config.js')).config
    const {handleApi,sendApiError}=await import('../router.js')
    server=http.createServer((req,res)=>{void handleApi(req,res,new URL(req.url!,origin)).catch(error=>sendApiError(res,error,req))})
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
    origin=`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
    for(const who of ['root','other-root','owner','trusted']) {
      const r=await fetch(origin+'/api/admin/auth/login',{method:'POST',headers:{origin:config.publicOrigin,'content-type':'application/json'},body:JSON.stringify({email:who+'@fixture.invalid',password:fixturePassword})})
      expect(r.status).toBe(200)
      const result=await r.json() as {csrfToken:string}
      sessions.set(who,{cookie:r.headers.get('set-cookie')!.split(';')[0]!,csrf:result.csrfToken})
    }
  },30_000)
  afterAll(async()=>{
    if(server)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))
    for(const target of state.targets.values())await target.close()
    await state.db?.close()
  })
  // No test in this file exercises rate-limiting itself, so clearing counts after each
  // test avoids unrelated later tests failing once enough tests share the same admin id.
  afterEach(async()=>{
    globalThis.fetch=nativeFetch
    const {__resetRateLimitBucketsForTests}=await import('../security.js')
    __resetRateLimitBucketsForTests()
  })
  const rows=async(table:string)=>(await state.db!.query('SELECT * FROM '+table+' ORDER BY id')).rows
  const appRows=async()=>(await state.db!.query('SELECT * FROM admin_onboarding_app_configs ORDER BY draft_id')).rows
  const scopeRows=async()=>(await state.db!.query('SELECT * FROM admin_onboarding_scopes ORDER BY draft_id')).rows
  const integrationRows=async()=>(await state.db!.query('SELECT * FROM admin_onboarding_integrations ORDER BY draft_id,provider')).rows
  const invitesFor=async(draftId:string)=>(await state.db!.query('SELECT * FROM admin_onboarding_invites WHERE draft_id=$1::uuid ORDER BY created_at',[draftId])).rows
  const companyAccessRows=async()=>(await state.db!.query('SELECT * FROM admin_company_access ORDER BY admin_id,company_id')).rows
  async function request(who:string,method:string,path='',body?:unknown,csrf=true,requestOrigin?:string) {
    const session=sessions.get(who)!
    return fetch(origin+'/api/admin/onboarding/drafts'+path,{method,headers:{cookie:session.cookie,origin:requestOrigin??config.publicOrigin,
      'content-type':'application/json',...(csrf?{'x-csrf-token':session.csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})})
  }
  async function readinessTarget() {
    const target=new PGlite()
    for(const file of ['017_spaceverse_runtime_binding.sql','018_spaceverse_runtime_scope_binding.sql']) {
      await target.exec(await fs.readFile(new URL('../../../migrations/'+file,import.meta.url),'utf8'))
    }
    await target.exec(`
      CREATE TABLE users (
        id BIGSERIAL PRIMARY KEY,telegram_id BIGINT UNIQUE,username TEXT,first_name TEXT NOT NULL,
        last_name TEXT,photo_url TEXT,role TEXT NOT NULL DEFAULT 'client',session_version BIGINT NOT NULL DEFAULT 1,deleted_at TIMESTAMPTZ,
        merged_into_user_id BIGINT REFERENCES users(id)
      );
      CREATE TABLE user_identities (
        id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,provider_user_id TEXT NOT NULL,provider_username TEXT,
        UNIQUE(provider,provider_user_id),UNIQUE(user_id,provider)
      );
      CREATE TABLE wallets (
        user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        balance BIGINT NOT NULL DEFAULT 0,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE transactions (
        id BIGSERIAL PRIMARY KEY,request_key TEXT UNIQUE,client_id BIGINT NOT NULL REFERENCES users(id),
        mode TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'completed'
      );
    `)
    for(const file of [
      '009_spaceverse_tenant_attribution.sql','019_spaceverse_customer_ownership.sql',
      '020_spaceverse_customer_create_requests.sql',
    ]) await target.exec(await fs.readFile(new URL('../../../migrations/'+file,import.meta.url),'utf8'))
    return target
  }

  it('both switches gate direct reads/writes before touching storage',async()=>{
    for(const flag of ['enableWrites','enableOnboardingDrafts'] as const) {
      config[flag]=false
      try {
        expect((await request('root','GET')).status).toBe(403)
        expect((await request('root','POST','',command())).status).toBe(403)
        const r=await fetch(origin+'/api/admin/auth/session',{headers:{cookie:sessions.get('root')!.cookie}})
        expect(await r.json()).toMatchObject({capabilities:{onboardingDrafts:false}})
      } finally {config[flag]=true}
    }
    expect(await rows('admin_onboarding_drafts')).toEqual([])
  })

  it('scope migration is additive, repeatable and creates no canonical rows by itself',async()=>{
    const sql=await fs.readFile(new URL('../../admin-migrations/006_onboarding_scope.sql',import.meta.url),'utf8')
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS admin_onboarding_scopes/i)
    expect(sql).not.toMatch(/(?:^|\n)\s*(?:INSERT|UPDATE|DELETE\s+FROM|MERGE|TRUNCATE)\b/i)
    expect(sql).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN|SCHEMA|DATABASE)\b/i)
    const before={companies:await rows('companies'),venues:await rows('venues'),scopes:await scopeRows()}
    await state.db!.exec(sql)
    expect({companies:await rows('companies'),venues:await rows('venues'),scopes:await scopeRows()}).toEqual(before)
  })

  it('encrypted integration migration is additive, repeatable and stores no provider resource by itself',async()=>{
    const sql=await fs.readFile(new URL('../../admin-migrations/009_onboarding_integrations.sql',import.meta.url),'utf8')
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS admin_onboarding_integrations/i)
    expect(sql).not.toMatch(/(?:^|\n)\s*(?:INSERT|UPDATE|DELETE\s+FROM|MERGE|TRUNCATE)\b/i)
    expect(sql).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN|SCHEMA|DATABASE)\b/i)
    const before={companies:await rows('companies'),venues:await rows('venues'),integrations:await integrationRows()}
    await state.db!.exec(sql)
    expect({companies:await rows('companies'),venues:await rows('venues'),integrations:await integrationRows()}).toEqual(before)
  })

  it('separately gates protected integrations and reports the capability honestly',async()=>{
    config.enableOnboardingIntegrations=false
    try {
      const path='/'+crypto.randomUUID()+'/integrations/evotor'
      expect((await request('root','GET',path)).status).toBe(403)
      expect((await request('root','PUT',path,{requestKey:crypto.randomUUID(),revision:0,storeId:'fixture',token:'synthetic-token-123456'})).status).toBe(403)
      const session=await fetch(origin+'/api/admin/auth/session',{headers:{cookie:sessions.get('root')!.cookie}})
      expect(await session.json()).toMatchObject({capabilities:{onboardingDrafts:true,onboardingIntegrations:false}})
      expect(await integrationRows()).toEqual([])
    } finally {config.enableOnboardingIntegrations=true}
  })

  it('separately gates provisioning and reports the capability honestly',async()=>{
    config.enableOnboardingProvisioning=false
    try {
      for(const step of ['runtime-database-binding','tenant-schema-readiness','runtime-bundle']) {
        const path='/'+crypto.randomUUID()+'/provisioning/'+step
        expect((await request('root','GET',path)).status).toBe(403)
        expect((await request('root','POST',path+'/run',{})).status).toBe(403)
      }
      const session=await fetch(origin+'/api/admin/auth/session',{headers:{cookie:sessions.get('root')!.cookie}})
      expect(await session.json()).toMatchObject({capabilities:{onboardingDrafts:true,onboardingProvisioning:false}})
      expect(await state.db!.query('SELECT * FROM admin_onboarding_provisioning_steps')).toMatchObject({rows:[]})
    } finally {config.enableOnboardingProvisioning=true}
  })

  it.each(['owner','trusted'])('denies %s every draft method and preserves credentials/access',async who=>{
    const before=await rows('admin_accounts')
    for(const [method,path,body] of [['GET','',undefined],['POST','',command()],['GET','/'+crypto.randomUUID(),undefined],['PUT','/'+crypto.randomUUID(),{revision:1,data}],
      ['GET','/'+crypto.randomUUID()+'/application',undefined],['PUT','/'+crypto.randomUUID()+'/application',{revision:0,config:appConfig}],
      ['GET','/'+crypto.randomUUID()+'/scope',undefined],['PUT','/'+crypto.randomUUID()+'/scope',{draftRevision:1,applicationRevision:1}],
      ['GET','/'+crypto.randomUUID()+'/integrations/evotor',undefined],
      ['PUT','/'+crypto.randomUUID()+'/integrations/evotor',{requestKey:crypto.randomUUID(),revision:0,storeId:'fixture',token:'synthetic-token-123456'}],
      ['POST','/'+crypto.randomUUID()+'/integrations/evotor/verify',{revision:1}],
      ['GET','/'+crypto.randomUUID()+'/provisioning/runtime-database-binding',undefined],
      ['POST','/'+crypto.randomUUID()+'/provisioning/runtime-database-binding/run',{}],
      ['GET','/'+crypto.randomUUID()+'/provisioning/tenant-schema-readiness',undefined],
      ['POST','/'+crypto.randomUUID()+'/provisioning/tenant-schema-readiness/run',{}],
      ['GET','/'+crypto.randomUUID()+'/provisioning/runtime-bundle',undefined],
      ['POST','/'+crypto.randomUUID()+'/provisioning/runtime-bundle/run',{}],
      ['DELETE','/'+crypto.randomUUID(),undefined]] as const) {
      const r=await request(who,method,path,body)
      expect(r.status).toBe(403);expect(await r.json()).toMatchObject({code:'SUPER_ADMIN_REQUIRED'})
    }
    expect(await rows('admin_accounts')).toEqual(before)
    expect(await rows('admin_onboarding_drafts')).toEqual([])
    const r=await fetch(origin+'/api/admin/venues',{headers:{cookie:sessions.get(who)!.cookie}})
    expect(await r.json()).toMatchObject({venues:[{companyId:'10',accessKind:who},{companyId:'10',accessKind:who}]})
  })

  it('requires a real session, same origin and CSRF',async()=>{
    expect((await fetch(origin+'/api/admin/onboarding/drafts')).status).toBe(401)
    expect((await request('root','POST','',command(),false)).status).toBe(403)
    expect((await request('root','POST','',command(),true,'https://foreign.invalid')).status).toBe(403)
    expect(await rows('admin_onboarding_drafts')).toEqual([])
  })

  it('creates/reopens one server draft and replays without changing canonical tenant/money/account data',async()=>{
    const protectedTables=['companies','venues','wallets','transactions','admin_accounts']
    const before=await Promise.all(protectedTables.map(rows))
    const input=command()
    const r=await request('root','POST','',input)
    expect(r.status).toBe(200)
    const saved=await r.json() as {id:string;revision:number;data:unknown}
    expect(saved).toMatchObject({data,status:'draft',revision:1,requestKey:input.requestKey})
    expect(await (await request('root','GET','/'+saved.id)).json()).toEqual(saved)
    expect(await (await request('root','GET','?requestKey='+input.requestKey)).json()).toEqual({draft:saved})
    expect(await (await request('other-root','GET','?requestKey='+input.requestKey)).json()).toEqual({draft:null})
    expect(await (await request('root','POST','',input)).json()).toEqual(saved)
    expect((await rows('admin_onboarding_drafts')).length).toBe(1)
    const index=await (await request('root','GET')).json() as {drafts:unknown[];companies:{id:string}[]}
    expect(index.drafts).toEqual([saved]);expect(index.companies.map(company=>company.id)).not.toContain('30')
    const conflict=await request('root','POST','',{...input,data:{...data,venueName:'Different'}})
    expect(conflict.status).toBe(409)
    expect(await Promise.all(protectedTables.map(rows))).toEqual(before)
    const logs=await rows('admin_audit_log')
    expect(logs.filter(row=>row.action==='onboarding.draft_create')).toHaveLength(1)
    expect(JSON.stringify(logs)).not.toContain(data.ownerEmail)
  })

  it('references existing companies without renaming or creating venues',async()=>{
    const before=await rows('companies')
    for(const companyId of ['10','20']) {
      const r=await request('root','POST','',{requestKey:crypto.randomUUID(),data:{...data,companyId,companyName:''}})
      expect(r.status).toBe(200);expect(await r.json()).toMatchObject({data:{companyId,companyName:''},status:'draft'})
    }
    expect(await rows('companies')).toEqual(before)
    expect((await request('root','POST','',{requestKey:crypto.randomUUID(),data:{...data,companyId:'30',companyName:''}})).status).toBe(404)
  })

  it('scopes drafts to their creator even between SUPER_ADMIN accounts',async()=>{
    const saved=await (await request('root','POST','',command())).json() as {id:string}
    expect((await request('other-root','GET','/'+saved.id)).status).toBe(404)
    expect((await request('other-root','PUT','/'+saved.id,{revision:1,data})).status).toBe(404)
    expect(await (await request('other-root','GET')).json()).toMatchObject({drafts:[]})
  })

  it('updates atomically, replays an uncertain PUT and rejects a stale edit',async()=>{
    const saved=await (await request('root','POST','',command())).json() as {id:string}
    const input={revision:1,data:{...data,address:'Новый адрес'}}
    const updated=await (await request('root','PUT','/'+saved.id,input)).json()
    expect(updated).toMatchObject({revision:2,data:input.data})
    expect(await (await request('root','PUT','/'+saved.id,input)).json()).toEqual(updated)
    const stale=await request('root','PUT','/'+saved.id,{revision:1,data:{...data,address:'Устаревшая правка'}})
    expect(stale.status).toBe(409)
    expect(await (await request('root','GET','/'+saved.id)).json()).toEqual(updated)
    expect((await rows('admin_audit_log')).filter(row=>row.action==='onboarding.draft_update'&&row.entity_id===saved.id)).toHaveLength(1)
  })

  it('saves one tenant-bound application blueprint without provisioning or legacy data access',async()=>{
    const protectedTables=['companies','venues','wallets','transactions','admin_accounts']
    const before=await Promise.all(protectedTables.map(rows))
    const draft=await (await request('root','POST','',command())).json() as {id:string}
    const empty=await (await request('root','GET','/'+draft.id+'/application')).json()
    expect(empty).toEqual({application:null,contract:{template:'standard',qrEnabled:true,isolationPolicy:'dedicated_database',legacyDataAccess:false,runtimeStatus:'not_provisioned',published:false}})
    const saved=await (await request('root','PUT','/'+draft.id+'/application',{revision:0,config:appConfig})).json() as {tenantKey:string;revision:number;runtimeManifest:unknown}
    expect(saved).toMatchObject({draftId:draft.id,config:appConfig,revision:1,contract:{template:'standard',qrEnabled:true,isolationPolicy:'dedicated_database',legacyDataAccess:false,runtimeStatus:'not_provisioned',published:false}})
    expect(saved.tenantKey).toMatch(/^sv-[0-9a-f]{32}$/)
    expect(saved.runtimeManifest).toBeNull()
    expect(JSON.stringify(saved.runtimeManifest)).not.toMatch(/token|secret|password|databaseUrl|https?:\/\//i)
    expect(await (await request('root','GET','/'+draft.id+'/application')).json()).toEqual({application:saved,contract:(saved as {contract:unknown}).contract})
    expect(await (await request('root','PUT','/'+draft.id+'/application',{revision:0,config:appConfig})).json()).toEqual(saved)
    expect(await appRows()).toHaveLength(1)
    expect(await Promise.all(protectedTables.map(rows))).toEqual(before)
    const audits=await rows('admin_audit_log')
    expect(audits.filter(row=>row.action==='onboarding.app_config_create'&&row.entity_id===draft.id)).toHaveLength(1)
    expect(JSON.stringify(audits)).not.toContain(appConfig.displayName)
  })

  it('isolates application config between operators and versions safe retries',async()=>{
    const draft=await (await request('root','POST','',command())).json() as {id:string}
    const created=await (await request('root','PUT','/'+draft.id+'/application',{revision:0,config:appConfig})).json() as {revision:number}
    expect(created.revision).toBe(1)
    expect((await request('other-root','GET','/'+draft.id+'/application')).status).toBe(404)
    expect((await request('other-root','PUT','/'+draft.id+'/application',{revision:0,config:appConfig})).status).toBe(404)
    const changed={...appConfig,displayName:'Мулино — приложение',shopEnabled:false}
    const updated=await (await request('root','PUT','/'+draft.id+'/application',{revision:1,config:changed})).json()
    expect(updated).toMatchObject({revision:2,config:changed})
    expect(await (await request('root','PUT','/'+draft.id+'/application',{revision:1,config:changed})).json()).toEqual(updated)
    const stale=await request('root','PUT','/'+draft.id+'/application',{revision:1,config:{...changed,theme:'light'}})
    expect(stale.status).toBe(409)
    expect(await (await request('root','GET','/'+draft.id+'/application')).json()).toMatchObject({application:updated})
  })

  it('atomically prepares inactive canonical company and venue IDs, reopens and safely replays',async()=>{
    const protectedTables=['wallets','transactions','admin_accounts']
    const protectedBefore=await Promise.all(protectedTables.map(rows))
    const activeBefore=await (await fetch(origin+'/api/admin/venues',{headers:{cookie:sessions.get('root')!.cookie}})).json()
    const companiesBefore=await rows('companies'),venuesBefore=await rows('venues')
    const draft=await (await request('root','POST','',command())).json() as {id:string;revision:number}
    const application=await (await request('root','PUT','/'+draft.id+'/application',{revision:0,config:appConfig})).json() as {revision:number;tenantKey:string}
    expect(await (await request('root','GET','/'+draft.id+'/scope')).json()).toEqual({scope:null,contract:{
      status:'prepared',venueActive:false,runtimeStatus:'not_provisioned',staffAccessGranted:false,providerConnectionsCreated:false,
    }})
    const body={draftRevision:draft.revision,applicationRevision:application.revision}
    const prepared=await (await request('root','PUT','/'+draft.id+'/scope',body)).json() as {
      draftId:string;company:{id:string;code:string;createdByOnboarding:boolean;active:boolean};venue:{id:string;code:string;active:boolean};revision:number;runtimeManifest:unknown
    }
    expect(prepared).toMatchObject({draftId:draft.id,company:{code:application.tenantKey,createdByOnboarding:true,active:false},
      venue:{code:application.tenantKey,active:false},source:body,revision:1,contract:{status:'prepared',venueActive:false,runtimeStatus:'not_provisioned',staffAccessGranted:false,providerConnectionsCreated:false}})
    expect(prepared.company.id).toMatch(/^[1-9]\d*$/);expect(prepared.venue.id).toMatch(/^[1-9]\d*$/)
    const manifest=parseSpaceverseRuntimeManifest(prepared.runtimeManifest)
    expect(manifest).toMatchObject({
      schemaVersion:2,runtimeKey:application.tenantKey,
      source:{kind:'onboarding',draftId:draft.id,draftRevision:draft.revision,
        applicationRevision:application.revision,scopeRevision:1},
      scope:{companyId:prepared.company.id,venueId:prepared.venue.id},
      application:{template:'standard',qrEnabled:true,...appConfig},
      isolation:{policy:'dedicated_database',legacyDataAccess:false},
      release:{runtimeStatus:'not_provisioned',published:false},
    })
    expect(JSON.stringify(manifest)).not.toMatch(/token|secret|password|databaseUrl|https?:\/\//i)
    const reopenedApp=await (await request('root','GET','/'+draft.id+'/application')).json() as {application:{runtimeManifest:unknown}}
    expect(reopenedApp.application.runtimeManifest).toEqual(prepared.runtimeManifest)
    expect(await (await request('root','GET','/'+draft.id+'/scope')).json()).toEqual({scope:prepared,contract:(prepared as {contract:unknown}).contract})
    expect(await (await request('root','PUT','/'+draft.id+'/scope',body)).json()).toEqual(prepared)
    expect(await scopeRows()).toHaveLength(1)
    expect((await rows('companies')).length).toBe(companiesBefore.length+1)
    expect((await rows('venues')).length).toBe(venuesBefore.length+1)
    expect(await Promise.all(protectedTables.map(rows))).toEqual(protectedBefore)
    expect(await (await fetch(origin+'/api/admin/venues',{headers:{cookie:sessions.get('root')!.cookie}})).json()).toEqual(activeBefore)
    const direct=await fetch(origin+'/api/admin/venues/'+prepared.venue.id+'/dashboard',{headers:{cookie:sessions.get('root')!.cookie}})
    expect(direct.status).toBe(404)
    const index=await (await request('root','GET')).json() as {companies:{id:string}[]}
    expect(index.companies.map(company=>company.id)).not.toContain(prepared.company.id)
    expect((await request('root','PUT','/'+draft.id,{revision:draft.revision,data:{...data,address:'После подготовки'}})).status).toBe(409)
    expect((await request('root','PUT','/'+draft.id+'/application',{revision:application.revision,config:{...appConfig,theme:'light'}})).status).toBe(409)
    const audits=await rows('admin_audit_log')
    const scopeAudits=audits.filter(row=>row.action==='onboarding.scope_prepare'&&row.entity_id===draft.id)
    expect(scopeAudits).toHaveLength(1)
    expect(scopeAudits[0]).toMatchObject({company_id:Number(prepared.company.id),venue_id:Number(prepared.venue.id)})
    expect(JSON.stringify(scopeAudits)).not.toContain(data.ownerEmail)
  })

  it('prepares two distinct inactive venues in one existing company without granting owner or trusted access',async()=>{
    const companiesBefore=await rows('companies')
    const activeBefore=await (await fetch(origin+'/api/admin/venues',{headers:{cookie:sessions.get('owner')!.cookie}})).json()
    const prepared=[] as Array<{draftId:string;company:{id:string;createdByOnboarding:boolean;active:boolean};venue:{id:string;active:boolean}}>
    for(const suffix of ['A','B']) {
      const input={requestKey:crypto.randomUUID(),data:{...data,companyId:'10',companyName:'',venueName:'Север '+suffix}}
      const draft=await (await request('root','POST','',input)).json() as {id:string;revision:number}
      const application=await (await request('root','PUT','/'+draft.id+'/application',{revision:0,config:{...appConfig,displayName:'Север '+suffix}})).json() as {revision:number}
      const result=await (await request('root','PUT','/'+draft.id+'/scope',{draftRevision:draft.revision,applicationRevision:application.revision})).json() as typeof prepared[number]
      prepared.push(result)
    }
    expect(await rows('companies')).toEqual(companiesBefore)
    expect(prepared.map(item=>item.company)).toEqual([
      {id:'10',code:'north',createdByOnboarding:false,active:true},
      {id:'10',code:'north',createdByOnboarding:false,active:true},
    ])
    expect(new Set(prepared.map(item=>item.venue.id)).size).toBe(2)
    expect(prepared.every(item=>item.venue.active===false)).toBe(true)
    expect(await (await fetch(origin+'/api/admin/venues',{headers:{cookie:sessions.get('owner')!.cookie}})).json()).toEqual(activeBefore)
    for(const item of prepared) {
      expect((await fetch(origin+'/api/admin/venues/'+item.venue.id+'/dashboard',{headers:{cookie:sessions.get('owner')!.cookie}})).status).toBe(404)
      expect((await request('other-root','GET','/'+item.draftId+'/scope')).status).toBe(404)
    }
  })

  async function preparedDraft(venueName=data.venueName) {
    const draft=await (await request('root','POST','',{requestKey:crypto.randomUUID(),data:{...data,venueName}})).json() as {id:string;revision:number}
    const application=await (await request('root','PUT','/'+draft.id+'/application',{revision:0,config:appConfig})).json() as {revision:number}
    await request('root','PUT','/'+draft.id+'/scope',{draftRevision:draft.revision,applicationRevision:application.revision})
    return draft
  }
  const provisioningPath=(draftId:string,suffix='')=>'/'+draftId+'/provisioning/runtime-database-binding'+suffix
  const schemaReadinessPath=(draftId:string,suffix='')=>'/'+draftId+'/provisioning/tenant-schema-readiness'+suffix
  const runtimeBundlePath=(draftId:string,suffix='')=>'/'+draftId+'/provisioning/runtime-bundle'+suffix

  it('exposes creator-scoped status/start, rejects target input and resumes after protected registration',async()=>{
    const draft=await preparedDraft('Provisioning HTTP')
    const application=await (await request('root','GET','/'+draft.id+'/application')).json() as {application:{tenantKey:string}}
    const path=provisioningPath(draft.id)
    expect(await (await request('root','GET',path)).json()).toMatchObject({
      draftId:draft.id,runtimeKey:application.application.tenantKey,status:'not_started',attemptCount:0,startAllowed:true,
    })
    expect((await request('owner','GET',path)).status).toBe(403)
    expect((await request('other-root','GET',path)).status).toBe(404)
    expect((await request('root','GET',path+'?databaseUrl=postgresql%3A%2F%2Fforbidden')).status).toBe(400)
    const rejected=await request('root','POST',path+'/run',{databaseUrl:'postgresql://forbidden.invalid/db'})
    expect(rejected.status).toBe(400);expect(await rejected.json()).toMatchObject({code:'ONBOARDING_PROVISIONING_COMMAND_INVALID'})
    expect((await state.db!.query('SELECT * FROM admin_onboarding_provisioning_steps')).rows).toEqual([])

    const missing=await (await request('root','POST',path+'/run',{})).json()
    expect(missing).toMatchObject({status:'action_required',attemptCount:1,errorCode:'TARGET_DATABASE_NOT_REGISTERED',startAllowed:true})

    const target=await readinessTarget()
    state.targets.set(application.application.tenantKey,target)
    const completed=await (await request('root','POST',path+'/run',{})).json() as {manifestSha256:string;scope:{companyId:string;venueId:string}}
    expect(completed).toMatchObject({status:'succeeded',attemptCount:2,errorCode:null,result:{binding:'created'},startAllowed:false})
    expect(await (await request('root','GET',path)).json()).toEqual(completed)
    expect((await target.query(`SELECT runtime_key,manifest_sha256,company_id,venue_id,status
      FROM spaceverse_runtime_binding`)).rows).toEqual([{
      runtime_key:application.application.tenantKey,manifest_sha256:completed.manifestSha256,
      company_id:completed.scope.companyId,venue_id:completed.scope.venueId,status:'prepared',
    }])
    const serialized=JSON.stringify({completed,audit:await rows('admin_audit_log')})
    expect(serialized).not.toMatch(/postgres:|password|databaseUrl|forbidden\.invalid/i)

    const schemaPath=schemaReadinessPath(draft.id)
    expect(await (await request('root','GET',schemaPath)).json()).toMatchObject({
      draftId:draft.id,step:'tenant_schema_readiness',status:'not_started',attemptCount:0,startAllowed:true,
    })
    expect((await request('owner','GET',schemaPath)).status).toBe(403)
    expect((await request('other-root','GET',schemaPath)).status).toBe(404)
    expect((await request('root','GET',schemaPath+'?databaseUrl=forbidden')).status).toBe(400)
    const schemaRejected=await request('root','POST',schemaPath+'/run',{runtimeKey:application.application.tenantKey})
    expect(schemaRejected.status).toBe(400);expect(await schemaRejected.json()).toMatchObject({code:'ONBOARDING_PROVISIONING_COMMAND_INVALID'})
    const schemaCompleted=await (await request('root','POST',schemaPath+'/run',{})).json()
    expect(schemaCompleted).toMatchObject({
      status:'succeeded',attemptCount:1,errorCode:null,startAllowed:false,
      result:{schema:'verified',migrationSet:'009,017-020',ownershipBoundary:'verified'},
    })
    expect(await (await request('root','GET',schemaPath)).json()).toEqual(schemaCompleted)
    expect(await (await request('root','POST',schemaPath+'/run',{})).json()).toEqual(schemaCompleted)
    expect(JSON.stringify({schemaCompleted,audit:await rows('admin_audit_log')})).not.toMatch(/postgres:|password|databaseUrl/i)

    const bundlePath=runtimeBundlePath(draft.id)
    expect(await (await request('root','GET',bundlePath)).json()).toMatchObject({
      draftId:draft.id,step:'runtime_bundle_verification',status:'not_started',attemptCount:0,startAllowed:true,
    })
    expect((await request('owner','GET',bundlePath)).status).toBe(403)
    expect((await request('other-root','GET',bundlePath)).status).toBe(404)
    expect((await request('root','GET',bundlePath+'?artifact=forbidden')).status).toBe(400)
    const bundleRejected=await request('root','POST',bundlePath+'/run',{manifest:{runtimeKey:application.application.tenantKey}})
    expect(bundleRejected.status).toBe(400);expect(await bundleRejected.json()).toMatchObject({code:'ONBOARDING_PROVISIONING_COMMAND_INVALID'})
    const missingRelease=await (await request('root','POST',bundlePath+'/run',{})).json()
    expect(missingRelease).toMatchObject({status:'action_required',attemptCount:1,errorCode:'RUNTIME_RELEASE_NOT_REGISTERED',result:null,startAllowed:true})
    const release=await createRuntimeRelease(fileURLToPath(new URL('../../../',import.meta.url)),'a'.repeat(40))
    const releaseDirectory=await fs.mkdtemp(nodePath.join(os.tmpdir(),'spaceverse-http-release-'))
    const releaseFile=nodePath.join(releaseDirectory,'release.json');await fs.writeFile(releaseFile,JSON.stringify(release))
    const operatorEnv={ADMIN_RUNTIME_RELEASE_SHA:release.sourceSha,ADMIN_RUNTIME_RELEASE_FINGERPRINT:release.fingerprint,ADMIN_RUNTIME_RELEASE_MANIFEST_FILE:releaseFile}
    const previous=Object.fromEntries(Object.keys(operatorEnv).map(key=>[key,process.env[key]]));Object.assign(process.env,operatorEnv)
    try{
    const bundleCompleted=await (await request('root','POST',bundlePath+'/run',{})).json()
    expect(bundleCompleted).toMatchObject({
      status:'succeeded',attemptCount:2,errorCode:null,startAllowed:false,
      result:{bundle:'verified',artifact:'pivnik-bonus-app',artifactContract:'tenant-runtime-v1',
        bundleSha256:expect.stringMatching(/^[0-9a-f]{64}$/),manifestSchemaVersion:2,
        runtimeStatus:'not_provisioned',published:false,codeRelease:{sourceSha:release.sourceSha,fingerprint:release.fingerprint}},
    })
    expect(await (await request('root','GET',bundlePath)).json()).toEqual(bundleCompleted)
    expect(await (await request('root','POST',bundlePath+'/run',{})).json()).toEqual(bundleCompleted)
    expect(JSON.stringify({bundleCompleted,audit:await rows('admin_audit_log')}))
      .not.toMatch(/postgres:|password|databaseUrl|SPACEVERSE_RUNTIME_MANIFEST_JSON/i)
    }finally{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value}}
  })

  it('requires a real session, same origin and CSRF to start provisioning',async()=>{
    const draft=await preparedDraft('Provisioning HTTP security')
    for(const path of [provisioningPath(draft.id,'/run'),schemaReadinessPath(draft.id,'/run'),runtimeBundlePath(draft.id,'/run')]) {
      expect((await fetch(origin+'/api/admin/onboarding/drafts'+path,{method:'POST',headers:{origin:config.publicOrigin,'content-type':'application/json'},body:'{}'})).status).toBe(401)
      expect((await request('root','POST',path,{},false)).status).toBe(403)
      expect((await request('root','POST',path,{},true,'https://foreign.invalid')).status).toBe(403)
    }
    expect((await state.db!.query(`SELECT * FROM admin_onboarding_provisioning_steps WHERE draft_id=$1::uuid`,[draft.id])).rows).toEqual([])
  })
  const evotorPath=(draftId:string,suffix='')=>'/'+draftId+'/integrations/evotor'+suffix

  it('saves, reopens and idempotently replays only a masked encrypted Evotor credential',async()=>{
    const draft=await preparedDraft('Эвотор — сохранение')
    const token='synthetic-evotor-token-'+crypto.randomUUID(),requestKey=crypto.randomUUID()
    const path=evotorPath(draft.id),input={requestKey,revision:0,storeId:'fixture-store-1',token}
    expect(await (await request('root','GET',path)).json()).toMatchObject({integration:null,contract:{
      provider:'evotor',credentialStorage:'server_encrypted',credentialExposure:'masked_only',verificationMethod:'documents_read',
      externalAccountCreated:false,posBindingCreated:false,runtimeStatus:'not_provisioned',
    }})
    const saved=await (await request('root','PUT',path,input)).json() as {revision:number;status:string;credential:unknown}
    expect(saved).toMatchObject({provider:'evotor',storeId:'fixture-store-1',revision:1,status:'configured',
      credential:{present:true,masked:'••••••••'},verification:{code:'not_verified',checkedAt:null,verifiedAt:null}})
    expect(JSON.stringify(saved)).not.toContain(token)
    expect(await (await request('root','GET',path)).json()).toMatchObject({integration:saved})
    expect(await (await request('root','PUT',path,input)).json()).toEqual(saved)
    const stored=await integrationRows()
    expect(stored).toHaveLength(1)
    expect(JSON.stringify(stored)).not.toContain(token)
    expect(stored[0]).toMatchObject({provider:'evotor',store_id:'fixture-store-1',status:'configured',revision:1,secret_key_id:'fixture-v1'})
    const conflicting=await request('root','PUT',path,{...input,token:token+'-changed'})
    expect(conflicting.status).toBe(409);expect(await conflicting.json()).toMatchObject({code:'ONBOARDING_INTEGRATION_REQUEST_CONFLICT'})
    expect((await request('other-root','GET',path)).status).toBe(404)
    const audits=(await rows('admin_audit_log')).filter(row=>row.action==='onboarding.integration_create'&&row.entity_id===draft.id)
    expect(audits).toHaveLength(1)
    expect(JSON.stringify(audits)).not.toContain(token)
    expect(JSON.stringify(audits)).not.toContain('fixture-store-1')
  })

  it('verifies document access through the existing Evotor adapter and records actionable failures without leaking responses',async()=>{
    const draft=await preparedDraft('Эвотор — проверка')
    const token='synthetic-verify-token-'+crypto.randomUUID(),path=evotorPath(draft.id)
    const configured=await (await request('root','PUT',path,{requestKey:crypto.randomUUID(),revision:0,storeId:'fixture-store-verify',token})).json() as {revision:number}
    globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const target=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url)
      if(target.hostname==='api.evotor.ru') {
        expect(target.pathname).toBe('/stores/fixture-store-verify/documents')
        expect(target.searchParams.get('type')).toBe('SELL,PAYBACK')
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer '+token)
        return new Response(JSON.stringify({items:[],paging:{}}),{status:200,headers:{'content-type':'application/json'}})
      }
      return nativeFetch(input,init)
    }) as typeof fetch
    const verified=await (await request('root','POST',evotorPath(draft.id,'/verify'),{revision:configured.revision})).json() as {revision:number;status:string}
    expect(verified).toMatchObject({revision:2,status:'verified',verification:{code:'documents_readable',checkedAt:expect.any(String),verifiedAt:expect.any(String)},
      contract:{posBindingCreated:false,runtimeStatus:'not_provisioned'}})
    expect(JSON.stringify(verified)).not.toContain(token)

    const changedToken=token+'-rotated'
    const rotated=await (await request('root','PUT',path,{requestKey:crypto.randomUUID(),revision:verified.revision,storeId:'fixture-store-verify',token:changedToken})).json() as {revision:number}
    const providerBody='provider-body-must-never-leak-'+crypto.randomUUID()
    globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const target=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url)
      if(target.hostname==='api.evotor.ru')return new Response(providerBody,{status:403})
      return nativeFetch(input,init)
    }) as typeof fetch
    const denied=await (await request('root','POST',evotorPath(draft.id,'/verify'),{revision:rotated.revision})).json()
    expect(denied).toMatchObject({revision:4,status:'action_required',verification:{code:'forbidden',checkedAt:expect.any(String),verifiedAt:null}})
    expect(JSON.stringify(denied)).not.toContain(providerBody)
    expect(JSON.stringify(await rows('admin_audit_log'))).not.toContain(providerBody)
    expect(JSON.stringify(await integrationRows())).not.toContain(changedToken)
  })

  it('treats an HTTP 200 with an invalid provider payload as an error, not as a connection',async()=>{
    const draft=await preparedDraft('Эвотор — неверный ответ')
    const path=evotorPath(draft.id),token='synthetic-invalid-response-'+crypto.randomUUID()
    const configured=await (await request('root','PUT',path,{requestKey:crypto.randomUUID(),revision:0,storeId:'fixture-invalid',token})).json() as {revision:number}
    globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const target=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url)
      if(target.hostname==='api.evotor.ru')return new Response(JSON.stringify({ok:true}),{status:200})
      return nativeFetch(input,init)
    }) as typeof fetch
    const result=await (await request('root','POST',evotorPath(draft.id,'/verify'),{revision:configured.revision})).json()
    expect(result).toMatchObject({status:'error',verification:{code:'invalid_response',verifiedAt:null}})
  })

  it('rewraps a verified credential under the active key before an old key is retired',async()=>{
    const draft=await preparedDraft('Эвотор — ротация ключа')
    const path=evotorPath(draft.id),token='synthetic-key-rotation-'+crypto.randomUUID()
    const configured=await (await request('root','PUT',path,{requestKey:crypto.randomUUID(),revision:0,storeId:'fixture-rotation',token})).json() as {revision:number}
    const originalId=process.env.ADMIN_ONBOARDING_SECRET_ACTIVE_KEY_ID,originalKeyring=process.env.ADMIN_ONBOARDING_SECRET_KEYRING
    const firstKey=Buffer.alloc(32,7).toString('base64'),secondKey=Buffer.alloc(32,8).toString('base64')
    globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const target=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url)
      if(target.hostname==='api.evotor.ru')return new Response(JSON.stringify({items:[],paging:{}}),{status:200})
      return nativeFetch(input,init)
    }) as typeof fetch
    try {
      process.env.ADMIN_ONBOARDING_SECRET_ACTIVE_KEY_ID='fixture-v2'
      process.env.ADMIN_ONBOARDING_SECRET_KEYRING=JSON.stringify({'fixture-v1':firstKey,'fixture-v2':secondKey})
      const verified=await request('root','POST',evotorPath(draft.id,'/verify'),{revision:configured.revision})
      expect(verified.status).toBe(200)
      expect((await integrationRows()).find(row=>row.draft_id===draft.id)).toMatchObject({secret_key_id:'fixture-v2',status:'verified'})
      process.env.ADMIN_ONBOARDING_SECRET_KEYRING=JSON.stringify({'fixture-v2':secondKey})
      const reopened=await request('root','GET',path)
      expect(reopened.status).toBe(200);expect(await reopened.json()).toMatchObject({integration:{status:'verified',credential:{masked:'••••••••'}}})
    } finally {
      process.env.ADMIN_ONBOARDING_SECRET_ACTIVE_KEY_ID=originalId
      process.env.ADMIN_ONBOARDING_SECRET_KEYRING=originalKeyring
    }
  })

  it('fails closed when the encryption key is missing or authenticated ciphertext is altered',async()=>{
    const draft=await preparedDraft('Эвотор — fail closed')
    const path=evotorPath(draft.id),token='synthetic-tamper-token-'+crypto.randomUUID()
    await request('root','PUT',path,{requestKey:crypto.randomUUID(),revision:0,storeId:'fixture-tamper',token})
    const originalKeyring=process.env.ADMIN_ONBOARDING_SECRET_KEYRING
    process.env.ADMIN_ONBOARDING_SECRET_KEYRING='{}'
    try {
      const missing=await request('root','GET',path)
      expect(missing.status).toBe(503);expect(await missing.json()).toMatchObject({code:'ONBOARDING_SECRET_KEY_UNAVAILABLE'})
    } finally {process.env.ADMIN_ONBOARDING_SECRET_KEYRING=originalKeyring}
    await state.db!.query(`UPDATE admin_onboarding_integrations SET secret_ciphertext=decode('00','hex') WHERE draft_id=$1::uuid`,[draft.id])
    const tampered=await request('root','GET',path)
    expect(tampered.status).toBe(503);expect(await tampered.json()).toMatchObject({code:'ONBOARDING_SECRET_KEY_UNAVAILABLE'})
  })

  it('requires a session, same origin and CSRF for Evotor credential changes and checks',async()=>{
    const draft=await preparedDraft('Эвотор — CSRF')
    const path=evotorPath(draft.id),body={requestKey:crypto.randomUUID(),revision:0,storeId:'fixture-csrf',token:'synthetic-csrf-token-123456'}
    expect((await fetch(origin+'/api/admin/onboarding/drafts'+path)).status).toBe(401)
    expect((await request('root','PUT',path,body,false)).status).toBe(403)
    expect((await request('root','PUT',path,body,true,'https://foreign.invalid')).status).toBe(403)
    const saved=await (await request('root','PUT',path,body)).json() as {revision:number}
    expect((await request('root','POST',evotorPath(draft.id,'/verify'),{revision:saved.revision},false)).status).toBe(403)
  })

  const invitesPath=(draftId:string,suffix='')=>'/'+draftId+'/invites'+suffix

  it('issues a one-time owner invite link, never stores or echoes the raw token, and audits it',async()=>{
    const draft=await preparedDraft('Приглашение — создание')
    expect(await (await request('root','GET',invitesPath(draft.id))).json()).toEqual({invites:[]})
    const created=await (await request('root','POST',invitesPath(draft.id))).json() as {id:string;draftId:string;status:string;token:string;expiresAt:string}
    expect(created).toMatchObject({draftId:draft.id,status:'pending'})
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    expect(new Date(created.expiresAt).getTime()).toBeGreaterThan(Date.now())
    const stored=await invitesFor(draft.id)
    expect(stored).toHaveLength(1)
    expect(JSON.stringify(stored)).not.toContain(created.token)
    expect(stored[0]).toMatchObject({id:created.id,status:'pending',created_by_admin_id:1})
    const listed=await (await request('root','GET',invitesPath(draft.id))).json() as {invites:unknown[]}
    expect(listed.invites).toEqual([{id:created.id,draftId:draft.id,status:'pending',expiresAt:created.expiresAt,createdAt:expect.any(String),revokedAt:null,claimedAt:null}])
    const audits=(await rows('admin_audit_log')).filter(row=>row.action==='onboarding.invite_create'&&row.entity_id===created.id)
    expect(audits).toHaveLength(1)
    expect(JSON.stringify(audits)).not.toContain(created.token)
  })

  it('auto-supersedes a previous pending invite so only the newest link is valid',async()=>{
    const draft=await preparedDraft('Приглашение — замена')
    const first=await (await request('root','POST',invitesPath(draft.id))).json() as {id:string}
    const second=await (await request('root','POST',invitesPath(draft.id))).json() as {id:string}
    const listed=await (await request('root','GET',invitesPath(draft.id))).json() as {invites:{id:string;status:string}[]}
    expect(listed.invites.find(invite=>invite.id===first.id)).toMatchObject({status:'revoked'})
    expect(listed.invites.find(invite=>invite.id===second.id)).toMatchObject({status:'pending'})
  })

  it('revokes an invite idempotently and denies another operator',async()=>{
    const draft=await preparedDraft('Приглашение — отзыв')
    const created=await (await request('root','POST',invitesPath(draft.id))).json() as {id:string}
    expect((await request('other-root','DELETE',invitesPath(draft.id,'/'+created.id))).status).toBe(404)
    const revoked=await (await request('root','DELETE',invitesPath(draft.id,'/'+created.id))).json()
    expect(revoked).toMatchObject({id:created.id,status:'revoked'})
    expect(await (await request('root','DELETE',invitesPath(draft.id,'/'+created.id))).json()).toEqual(revoked)
    expect((await rows('admin_audit_log')).filter(row=>row.action==='onboarding.invite_revoke'&&row.entity_id===created.id)).toHaveLength(1)
  })

  it('refuses an invite before the venue scope is prepared, without creating any row',async()=>{
    const draft=await (await request('root','POST','',command())).json() as {id:string}
    expect((await request('root','POST',invitesPath(draft.id))).status).toBe(409)
    expect((await request('root','GET',invitesPath(draft.id))).status).toBe(409)
    expect(await invitesFor(draft.id)).toEqual([])
  })

  it('requires a signed session, same origin and CSRF for invite creation and revocation',async()=>{
    const draft=await preparedDraft('Приглашение — CSRF')
    expect((await fetch(origin+'/api/admin/onboarding/drafts'+invitesPath(draft.id))).status).toBe(401)
    expect((await request('root','POST',invitesPath(draft.id),undefined,false)).status).toBe(403)
    expect((await request('root','POST',invitesPath(draft.id),undefined,true,'https://foreign.invalid')).status).toBe(403)
    expect(await invitesFor(draft.id)).toEqual([])
    const created=await (await request('root','POST',invitesPath(draft.id))).json() as {id:string}
    expect((await request('root','DELETE',invitesPath(draft.id,'/'+created.id),undefined,false)).status).toBe(403)
  })

  it.each(['owner','trusted'])('denies %s every invite method',async who=>{
    const draft=await preparedDraft('Приглашение — доступ '+who)
    for(const [method,suffix] of [['GET',''],['POST',''],['DELETE','/'+crypto.randomUUID()]] as const) {
      const r=await request(who,method,invitesPath(draft.id,suffix))
      expect(r.status).toBe(403);expect(await r.json()).toMatchObject({code:'SUPER_ADMIN_REQUIRED'})
    }
  })

  it('fails closed when the invite migration is missing, without breaking scope reads',async()=>{
    const draft=await preparedDraft('Приглашение — без миграции')
    await state.db!.exec('ALTER TABLE admin_onboarding_invites RENAME TO fixture_saved_onboarding_invites')
    try {
    for(const [method,suffix] of [['GET',''],['POST',''],['DELETE','/'+crypto.randomUUID()]] as const) {
      const r=await request('root',method,invitesPath(draft.id,suffix))
      expect(r.status).toBe(503);expect(await r.json()).toMatchObject({code:'ONBOARDING_INVITE_NOT_READY'})
    }
    expect((await request('root','GET','/'+draft.id+'/scope')).status).toBe(200)
    } finally {await state.db!.exec('ALTER TABLE fixture_saved_onboarding_invites RENAME TO admin_onboarding_invites')}
  })

  async function createInviteFor(draftId:string) {
    return await (await request('root','POST',invitesPath(draftId))).json() as {id:string;token:string}
  }
  const claim=(body:unknown,requestOrigin?:string)=>fetch(origin+'/api/admin/onboarding/invite/claim',
    {method:'POST',headers:{origin:requestOrigin??config.publicOrigin,'content-type':'application/json'},body:JSON.stringify(body)})
  const preview=(token:string)=>fetch(origin+'/api/admin/onboarding/invite/'+encodeURIComponent(token))

  it('shows only the venue/company name for a pending link and 404s once it is gone',async()=>{
    const draft=await preparedDraft('Приглашение — превью')
    const invite=await createInviteFor(draft.id)
    const shown=await (await preview(invite.token)).json()
    expect(shown).toEqual({venueName:'Приглашение — превью',companyName:data.companyName})
    expect((await preview('not-a-real-token-but-shaped-like-one-0000')).status).toBe(404)
    await request('root','DELETE',invitesPath(draft.id,'/'+invite.id))
    expect((await preview(invite.token)).status).toBe(404)
  })

  it('claims a pending invite into a brand-new VENUE_ADMIN with owner access and signs them in',async()=>{
    const draft=await preparedDraft('Приглашение — редемпция')
    const scope=(await (await request('root','GET','/'+draft.id+'/scope')).json() as {scope:{company:{id:string}}}).scope
    const invite=await createInviteFor(draft.id)
    const email='new-owner-'+crypto.randomUUID()+'@claim.invalid'
    const before=await rows('admin_accounts')
    const r=await claim({token:invite.token,email,displayName:'Новый владелец',password:'Correct-Horse-Battery-123'})
    expect(r.status).toBe(200)
    const body=await r.json() as {admin:{id:string;email:string;role:string};csrfToken:string}
    expect(body).toMatchObject({admin:{email,displayName:'Новый владелец',role:'VENUE_ADMIN'}})
    expect(body.csrfToken).toBeTruthy()
    expect(r.headers.get('set-cookie')).toBeTruthy()
    const accounts=await rows('admin_accounts')
    expect(accounts.length).toBe(before.length+1)
    const created=accounts.find(account=>account.email===email)!
    expect(String(created.id)).toBe(body.admin.id);expect(created.role).toBe('VENUE_ADMIN')
    expect((await companyAccessRows()).some(grant=>String(grant.admin_id)===body.admin.id&&String(grant.company_id)===scope.company.id&&grant.access_kind==='owner')).toBe(true)
    const stored=(await invitesFor(draft.id)).find(row=>row.id===invite.id)!
    expect(stored).toMatchObject({status:'claimed'});expect(String(stored.claimed_admin_id)).toBe(body.admin.id)
    const audits=(await rows('admin_audit_log')).filter(row=>row.action==='onboarding.invite_claim'&&row.entity_id===invite.id)
    expect(audits).toHaveLength(1)
    expect(JSON.stringify(audits)).not.toContain('Correct-Horse-Battery-123')
  })

  it('refuses to reuse an already-claimed or revoked token',async()=>{
    const draftClaimed=await preparedDraft('Приглашение — повтор после редемпции')
    const claimedInvite=await createInviteFor(draftClaimed.id)
    const firstClaim=await claim({token:claimedInvite.token,email:'once-'+crypto.randomUUID()+'@claim.invalid',displayName:'Once',password:'Correct-Horse-Battery-123'})
    expect(firstClaim.status).toBe(200)
    const before=await rows('admin_accounts')
    const second=await claim({token:claimedInvite.token,email:'twice-'+crypto.randomUUID()+'@claim.invalid',displayName:'Twice',password:'Correct-Horse-Battery-123'})
    expect(second.status).toBe(404)
    expect(await rows('admin_accounts')).toEqual(before)

    const draftRevoked=await preparedDraft('Приглашение — повтор после отзыва')
    const revokedInvite=await createInviteFor(draftRevoked.id)
    await request('root','DELETE',invitesPath(draftRevoked.id,'/'+revokedInvite.id))
    const afterRevoke=await claim({token:revokedInvite.token,email:'revoked-'+crypto.randomUUID()+'@claim.invalid',displayName:'X',password:'Correct-Horse-Battery-123'})
    expect(afterRevoke.status).toBe(404)
  })

  it('refuses an email that already has an admin account, without creating anything',async()=>{
    const draft=await preparedDraft('Приглашение — существующий email')
    const invite=await createInviteFor(draft.id)
    const before={accounts:await rows('admin_accounts'),access:await companyAccessRows()}
    const r=await claim({token:invite.token,email:'owner@fixture.invalid',displayName:'Дубликат',password:'Correct-Horse-Battery-123'})
    expect(r.status).toBe(409);expect(await r.json()).toMatchObject({code:'ONBOARDING_ACCOUNT_EXISTS'})
    expect({accounts:await rows('admin_accounts'),access:await companyAccessRows()}).toEqual(before)
    expect((await invitesFor(draft.id)).find(row=>row.id===invite.id)).toMatchObject({status:'pending'})
  })

  it('rejects malformed claim input without creating an account, and the link survives to be claimed properly',async()=>{
    const draft=await preparedDraft('Приглашение — валидация')
    const invite=await createInviteFor(draft.id)
    const before=await rows('admin_accounts')
    for(const invalidField of [
      {password:'too-short'}, {email:'not-an-email'}, {email:''}, {displayName:''}, {displayName:'x'.repeat(121)}, {token:''},
    ]) {
      const r=await claim({token:invite.token,email:'valid-'+crypto.randomUUID()+'@claim.invalid',displayName:'Valid',password:'Correct-Horse-Battery-123',...invalidField})
      expect([400,404]).toContain(r.status)
    }
    expect(await rows('admin_accounts')).toEqual(before)
    expect((await invitesFor(draft.id)).find(row=>row.id===invite.id)).toMatchObject({status:'pending'})
    expect((await claim({token:invite.token,email:'finally-'+crypto.randomUUID()+'@claim.invalid',displayName:'Valid',password:'Correct-Horse-Battery-123'})).status).toBe(200)
  })

  it('requires same origin to claim a link, without creating anything',async()=>{
    const draft=await preparedDraft('Приглашение — origin')
    const invite=await createInviteFor(draft.id)
    const before=await rows('admin_accounts')
    const r=await claim({token:invite.token,email:'origin-'+crypto.randomUUID()+'@claim.invalid',displayName:'Origin',password:'Correct-Horse-Battery-123'},'https://foreign.invalid')
    expect(r.status).toBe(403)
    expect(await rows('admin_accounts')).toEqual(before)
  })

  it('requires current source revisions and a saved app before preparing scope',async()=>{
    const draft=await (await request('root','POST','',command())).json() as {id:string;revision:number}
    const before={companies:await rows('companies'),venues:await rows('venues'),scopes:await scopeRows()}
    expect((await request('root','PUT','/'+draft.id+'/scope',{draftRevision:1,applicationRevision:1})).status).toBe(409)
    const application=await (await request('root','PUT','/'+draft.id+'/application',{revision:0,config:appConfig})).json() as {revision:number}
    for(const body of [
      {draftRevision:99,applicationRevision:application.revision},
      {draftRevision:draft.revision,applicationRevision:99},
      {draftRevision:draft.revision,applicationRevision:application.revision,companyId:'10'},
      {draftRevision:draft.revision,applicationRevision:application.revision,venueId:'20'},
      {draftRevision:draft.revision,applicationRevision:application.revision,token:'synthetic-secret'},
      {draftRevision:'1',applicationRevision:application.revision},
    ]) {
      const r=await request('root','PUT','/'+draft.id+'/scope',body)
      expect([400,409]).toContain(r.status);expect(JSON.stringify(await r.json())).not.toContain('synthetic-secret')
    }
    expect({companies:await rows('companies'),venues:await rows('venues'),scopes:await scopeRows()}).toEqual(before)
  })

  it('requires session, same origin and CSRF for canonical scope preparation',async()=>{
    const draft=await (await request('root','POST','',command())).json() as {id:string;revision:number}
    const application=await (await request('root','PUT','/'+draft.id+'/application',{revision:0,config:appConfig})).json() as {revision:number}
    const path='/'+draft.id+'/scope',body={draftRevision:draft.revision,applicationRevision:application.revision},before=await scopeRows()
    expect((await fetch(origin+'/api/admin/onboarding/drafts'+path)).status).toBe(401)
    expect((await request('root','PUT',path,body,false)).status).toBe(403)
    expect((await request('root','PUT',path,body,true,'https://foreign.invalid')).status).toBe(403)
    expect(await scopeRows()).toEqual(before)
  })

  it('requires a signed session, same origin and CSRF for application config',async()=>{
    const draft=await (await request('root','POST','',command())).json() as {id:string}
    const path='/'+draft.id+'/application',before=await appRows()
    expect((await fetch(origin+'/api/admin/onboarding/drafts'+path)).status).toBe(401)
    expect((await request('root','PUT',path,{revision:0,config:appConfig},false)).status).toBe(403)
    expect((await request('root','PUT',path,{revision:0,config:appConfig},true,'https://foreign.invalid')).status).toBe(403)
    const secret=await request('root','PUT',path,{revision:0,config:appConfig,token:'synthetic-secret'})
    expect(secret.status).toBe(400);expect(JSON.stringify(await secret.json())).not.toContain('synthetic-secret')
    expect(await appRows()).toEqual(before)
  })

  it.each([
    {token:'synthetic-secret'}, {logoUrl:'https://secret.invalid/logo'}, {theme:'unknown'},
    {primaryColor:'red'}, {secondaryColor:'#12345g'}, {shopEnabled:'true'}, {loyaltyEnabled:null},
    {displayName:'x'.repeat(121)},
  ])('rejects unsafe or malformed application fields without storing or echoing them: %j',async invalidConfig=>{
    const draft=await (await request('root','POST','',command())).json() as {id:string}
    const before=await appRows()
    const r=await request('root','PUT','/'+draft.id+'/application',{revision:0,config:{...appConfig,...invalidConfig}})
    expect(r.status).toBe(400)
    expect(JSON.stringify(await r.json())).not.toContain('synthetic-secret')
    expect(await appRows()).toEqual(before)
  })

  it.each([
    {token:'synthetic-secret'}, {role:'SUPER_ADMIN'}, {companyId:'9223372036854775808'},
    {timeZone:'No/SuchZone'}, {ownerEmail:'invalid'}, {venueName:'x'.repeat(121)}, {companyName:null},
    {companyId:'10',companyName:'Implicit rename'}, {venueType:'unknown'},
  ])('rejects forbidden or malformed draft data without echoing it: %j',async invalidData=>{
    const before=await rows('admin_onboarding_drafts')
    const r=await request('root','POST','',{requestKey:crypto.randomUUID(),data:{...data,...invalidData}})
    expect(r.status).toBe(400)
    expect(JSON.stringify(await r.json())).not.toContain('synthetic-secret')
    expect(await rows('admin_onboarding_drafts')).toEqual(before)
  })

  it('rejects oversized bodies and unsupported methods',async()=>{
    expect((await request('root','POST','',{junk:'x'.repeat(9000)})).status).toBe(413)
    expect((await request('root','DELETE','/'+crypto.randomUUID())).status).toBe(405)
    expect((await request('root','PUT','/'+crypto.randomUUID()+'/application',{junk:'x'.repeat(5000)})).status).toBe(413)
    expect((await request('root','POST','/'+crypto.randomUUID()+'/application',{})).status).toBe(405)
    expect((await request('root','PUT','/'+crypto.randomUUID()+'/scope',{junk:'x'.repeat(2000)})).status).toBe(413)
    expect((await request('root','POST','/'+crypto.randomUUID()+'/scope',{})).status).toBe(405)
  })

  it('rolls back draft and audit together and never logs sensitive database errors',async()=>{
    const before=await rows('admin_onboarding_drafts'),input=command(),logs=vi.spyOn(console,'error')
    state.failAudit=true
    try {
      const r=await request('root','POST','',input)
      expect(r.status).toBe(503)
      expect(JSON.stringify(await r.json())).not.toContain('Synthetic sensitive')
      expect(await rows('admin_onboarding_drafts')).toEqual(before)
      expect(logs).not.toHaveBeenCalled()
    } finally {state.failAudit=false;logs.mockRestore()}
    expect((await request('root','POST','',input)).status).toBe(200)
  })

  it('rolls back application config and audit together after a partial failure',async()=>{
    const draft=await (await request('root','POST','',command())).json() as {id:string}
    const before=await appRows(),logs=vi.spyOn(console,'error')
    state.failAudit=true
    try {
      const r=await request('root','PUT','/'+draft.id+'/application',{revision:0,config:appConfig})
      expect(r.status).toBe(503)
      expect(await appRows()).toEqual(before)
      expect(logs).not.toHaveBeenCalled()
    } finally {state.failAudit=false;logs.mockRestore()}
    expect((await request('root','PUT','/'+draft.id+'/application',{revision:0,config:appConfig})).status).toBe(200)
  })

  it('rolls back canonical company, venue and scope together when audit fails',async()=>{
    const draft=await (await request('root','POST','',command())).json() as {id:string;revision:number}
    const application=await (await request('root','PUT','/'+draft.id+'/application',{revision:0,config:appConfig})).json() as {revision:number}
    const path='/'+draft.id+'/scope',body={draftRevision:draft.revision,applicationRevision:application.revision}
    const before={companies:await rows('companies'),venues:await rows('venues'),scopes:await scopeRows()},logs=vi.spyOn(console,'error')
    state.failAudit=true
    try {
      const r=await request('root','PUT',path,body)
      expect(r.status).toBe(503)
      expect(await r.json()).toMatchObject({code:'ONBOARDING_UNAVAILABLE'})
      expect({companies:await rows('companies'),venues:await rows('venues'),scopes:await scopeRows()}).toEqual(before)
      expect(logs).not.toHaveBeenCalled()
    } finally {state.failAudit=false;logs.mockRestore()}
    expect((await request('root','PUT',path,body)).status).toBe(200)
  })

  it('fails scope endpoints closed when optional migration 006 is missing without breaking draft/application reads',async()=>{
    const draft=await (await request('root','POST','',command())).json() as {id:string}
    const application=await (await request('root','PUT','/'+draft.id+'/application',{revision:0,config:appConfig})).json()
    // Optional integration storage has an intentional RESTRICT dependency on a prepared scope.
    await state.db!.exec('DROP TABLE admin_onboarding_integrations; DROP TABLE admin_onboarding_scopes')
    for(const method of ['GET','PUT']) {
      const r=await request('root',method,'/'+draft.id+'/scope',method==='PUT'?{draftRevision:1,applicationRevision:1}:undefined)
      expect(r.status).toBe(503);expect(await r.json()).toMatchObject({code:'ONBOARDING_SCOPE_NOT_READY'})
    }
    expect(await (await request('root','GET','/'+draft.id)).json()).toMatchObject({id:draft.id})
    expect(await (await request('root','GET','/'+draft.id+'/application')).json()).toMatchObject({application})
  })

  it('fails closed when the separately applied application migration is missing',async()=>{
    const draft=await (await request('root','POST','',command())).json() as {id:string}
    await state.db!.exec('DROP TABLE admin_onboarding_app_configs')
    for(const method of ['GET','PUT']) {
      const r=await request('root',method,'/'+draft.id+'/application',method==='PUT'?{revision:0,config:appConfig}:undefined)
      expect(r.status).toBe(503);expect(await r.json()).toMatchObject({code:'ONBOARDING_APP_NOT_READY'})
    }
    expect((await request('root','GET','/'+draft.id)).status).toBe(200)
  })

  it('fails closed without the separately applied optional migration',async()=>{
    const before=await rows('companies')
    await state.db!.exec('DROP TABLE admin_onboarding_drafts CASCADE')
    for(const method of ['GET','POST']) {
      const r=await request('root',method,'',method==='POST'?command():undefined)
      expect(r.status).toBe(503);expect(await r.json()).toMatchObject({code:'ONBOARDING_NOT_READY'})
    }
    expect(await rows('companies')).toEqual(before)
  })
})
