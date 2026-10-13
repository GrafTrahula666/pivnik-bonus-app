// @vitest-environment node
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest'
import { parseSpaceverseRuntimeManifest } from '../../../spaceverse-runtime-manifest.js'

const state=vi.hoisted(()=>({db:null as PGlite|null,failAudit:false}))
vi.mock('../db.js',()=>{
  const query=async(text:string,params?:unknown[])=>{
    if(state.failAudit&&text.startsWith('INSERT INTO admin_audit_log')) throw new Error('Synthetic sensitive database details')
    const r=await state.db!.query(text,params)
    return {...r,rowCount:r.rows.length||r.affectedRows||0}
  }
  const adapter={query,connect:async()=>({query,release(){}})}
  return {pool:adapter,readPool:adapter,writePool:null,tableExists:async()=>false,productionTableExists:async()=>false}
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
    await state.db?.close()
  })
  const rows=async(table:string)=>(await state.db!.query('SELECT * FROM '+table+' ORDER BY id')).rows
  const appRows=async()=>(await state.db!.query('SELECT * FROM admin_onboarding_app_configs ORDER BY draft_id')).rows
  const scopeRows=async()=>(await state.db!.query('SELECT * FROM admin_onboarding_scopes ORDER BY draft_id')).rows
  async function request(who:string,method:string,path='',body?:unknown,csrf=true,requestOrigin?:string) {
    const session=sessions.get(who)!
    return fetch(origin+'/api/admin/onboarding/drafts'+path,{method,headers:{cookie:session.cookie,origin:requestOrigin??config.publicOrigin,
      'content-type':'application/json',...(csrf?{'x-csrf-token':session.csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})})
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

  it.each(['owner','trusted'])('denies %s every draft method and preserves credentials/access',async who=>{
    const before=await rows('admin_accounts')
    for(const [method,path,body] of [['GET','',undefined],['POST','',command()],['GET','/'+crypto.randomUUID(),undefined],['PUT','/'+crypto.randomUUID(),{revision:1,data}],
      ['GET','/'+crypto.randomUUID()+'/application',undefined],['PUT','/'+crypto.randomUUID()+'/application',{revision:0,config:appConfig}],
      ['GET','/'+crypto.randomUUID()+'/scope',undefined],['PUT','/'+crypto.randomUUID()+'/scope',{draftRevision:1,applicationRevision:1}],
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
    await state.db!.exec('DROP TABLE admin_onboarding_scopes')
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
