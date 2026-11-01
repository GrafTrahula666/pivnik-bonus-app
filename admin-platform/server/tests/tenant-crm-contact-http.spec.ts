// @vitest-environment node
// Signed HTTP acceptance for the default-off CHAT 03 / #24 manual-contact POST.
// PGlite + completely synthetic metadata and three isolated tenant databases.
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest'
import {config} from '../config.js'
import {fixturePassword} from './onboarding-fixture.js'
import {tenantCrmFixture} from './tenant-crm-fixture.js'
import type {TenantCrmFixtureDatabase} from './tenant-crm-database-fixture.js'

const state=vi.hoisted(()=>({metadata:null as TenantCrmFixtureDatabase|null,
  targets:new Map<string,TenantCrmFixtureDatabase>(),targetResolutions:0}))
const connect=(db:TenantCrmFixtureDatabase)=>db.connect?db.connect():Promise.resolve({
  query:db.query.bind(db),release:()=>{}
})
vi.mock('../db.js',()=>{
  const db={query:(sql:string,params?:unknown[])=>state.metadata!.query(sql,params),
    connect:()=>connect(state.metadata!)}
  return {pool:db,readPool:db,writePool:null,tableExists:async()=>false,productionTableExists:async()=>false}
})
vi.mock('../onboarding-database-registry.js',()=>({
  onboardingTargetRegistry:{resolveTargetDatabase:async(key:string)=>{
    state.targetResolutions++
    const db=state.targets.get(key)
    return db?{connect:()=>connect(db)}:null
  }},
  validateOnboardingTargetRegistry:()=>({registered:state.targets.size}),
  closeOnboardingTargetRegistry:async()=>{}
}))

describe('CHAT03 #24 signed Admin manual CRM contact POST (feature default-off)',()=>{
  let server:http.Server,origin=''
  let fixture:Awaited<ReturnType<typeof tenantCrmFixture>>
  const sessions=new Map<string,{cookie:string;csrf:string}>()
  const path=(index=0)=>'/api/admin/onboarding/drafts/'+fixture.manifests[index]!.source.draftId+'/crm/contacts'
  const command=(email:string,key=crypto.randomUUID())=>({
    requestKey:key,contact:{firstName:'Мария',lastName:'Тест',email,phone:null},
  })
  const send=async(who:string|null,target:string,body:unknown,opts:{
    method?:string;origin?:string;csrf?:boolean;headers?:Record<string,string>
  }={})=>{
    const session=who?sessions.get(who):null
    const method=opts.method||'POST'
    return fetch(origin+target,{method,headers:{
      'origin':opts.origin??config.publicOrigin,'content-type':'application/json',
      ...(session?{cookie:session.cookie}:{}),
      ...(session&&opts.csrf!==false?{'x-csrf-token':session.csrf}:{}),
      ...opts.headers,
    },...(method==='GET'?{}:{body:JSON.stringify(body)})})
  }
  const count=async(i:number,table:string)=>(await fixture.targets[i]!.query<{n:string}>(
    'SELECT COUNT(*)::text AS n FROM '+table)).rows[0]!.n

  beforeAll(async()=>{
    expect(config.enableTenantCrmContactCreate).toBe(false)
    fixture=await tenantCrmFixture()
    state.metadata=fixture.metadata
    fixture.manifests.forEach((m,i)=>state.targets.set(m.runtimeKey,fixture.targets[i]!))
    const sql=await fs.readFile(new URL('../../tenant-migrations/002_manual_crm_contacts.sql',import.meta.url),'utf8')
    for(const target of fixture.targets){
      await target.exec("SET spaceverse.crm_contacts_migration='approved'")
      await target.exec(sql)
    }
    config.enableWrites=config.enableOnboardingDrafts=config.enableOnboardingInvitations=true
    config.publicOrigin='https://crm-contact.fixture.invalid'
    config.csrfSecret='crm-contact-test-secret-of-over-32-characters'
    const {handleApi,sendApiError}=await import('../router.js')
    server=http.createServer((req,res)=>{
      void handleApi(req,res,new URL(req.url!,origin)).catch(error=>sendApiError(res,error,req))
    })
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
    origin='http://127.0.0.1:'+(server.address() as import('node:net').AddressInfo).port
    for(const who of ['owner','trusted','south','root','other-root']){
      const response=await send(null,'/api/admin/auth/login',
        {email:who+'@fixture.invalid',password:fixturePassword})
      expect(response.status).toBe(200)
      const body=await response.json()
      sessions.set(who,{cookie:response.headers.get('set-cookie')!.split(';')[0]!,
        csrf:body.csrfToken})
    }
  },90_000)
  afterEach(async()=>{
    config.enableTenantCrmContactCreate=false
    state.targetResolutions=0
    const {__resetRateLimitBucketsForTests}=await import('../security.js')
    __resetRateLimitBucketsForTests()
  })
  afterAll(async()=>{
    if(server)await new Promise<void>(resolve=>server.close(()=>resolve()))
    for(const target of fixture?.targets||[])await target.close()
    await fixture?.metadata.close()
  })

  it('reports the create capability disabled and does not resolve a tenant by default',async()=>{
    const session=await send('owner','/api/admin/auth/session',null,{method:'GET'})
    expect((await session.json()).capabilities.tenantCrmContactCreate).toBe(false)
    const response=await send('owner',path(),command('off@fixture.invalid'))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({code:'TENANT_CRM_CONTACT_CREATE_DISABLED'})
    expect(state.targetResolutions).toBe(0)
    expect(await count(0,'spaceverse_crm_contacts')).toBe('0')
  })
  it('requires signed session, CSRF and exact Origin before accessing tenant',async()=>{
    config.enableTenantCrmContactCreate=true
    const c=command('denied@fixture.invalid')
    expect((await send(null,path(),c)).status).toBe(401)
    expect((await send('owner',path(),c,{csrf:false})).status).toBe(403)
    expect((await send('owner',path(),c,{origin:'https://evil.invalid'})).status).toBe(403)
    expect((await send('owner',path(),c,{method:'PUT'})).status).toBe(405)
    expect(state.targetResolutions).toBe(0)
  })
  it('rejects user-supplied database scope, invalid contact and unsupported method',async()=>{
    config.enableTenantCrmContactCreate=true
    const c=command('params@fixture.invalid')
    expect((await send('owner',path()+'?companyId=20',c)).status).toBe(400)
    expect((await send('owner',path(),{...c,companyId:'20'})).status).toBe(400)
    expect((await send('owner',path(),{requestKey:crypto.randomUUID(),contact:{firstName:'A'}})).status).toBe(400)
    expect((await send('owner',path(),{...c,contact:{...c.contact,email:'wrong'}})).status).toBe(400)
    expect(state.targetResolutions).toBe(0)
  })
  it('denies invited manager and a foreign company owner even if a target is connected',async()=>{
    config.enableTenantCrmContactCreate=true
    const c=command('foreign@fixture.invalid')
    expect([403,404]).toContain((await send('trusted',path(),c)).status)
    expect([403,404]).toContain((await send('south',path(),c)).status)
    expect([403,404]).toContain((await send('owner',path(2),c)).status)
    expect(state.targetResolutions).toBe(0)
  })
  it('creates one unlinked contact and audits scope; same key replays exactly once',async()=>{
    config.enableTenantCrmContactCreate=true
    const c=command('idempotent@fixture.invalid')
    const before=(await count(0,'spaceverse_crm_contacts'))
    const users=await count(0,'users'),wallets=await count(0,'wallets')
    const first=await send('owner',path(),c)
    expect(first.status).toBe(200)
    const payload=await first.json()
    expect(payload).toMatchObject({schemaVersion:1,requestKey:c.requestKey,
      identityStatus:'unlinked',walletStatus:'not_created',contact:{
        firstName:'Мария',email:c.contact.email,identityStatus:'unlinked',walletStatus:'not_created'}})
    const replay=await send('owner',path(),c)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual(payload)
    expect(Number(await count(0,'spaceverse_crm_contacts'))).toBe(Number(before)+1)
    expect(await count(0,'spaceverse_crm_contact_create_requests')).toBe('1')
    expect(await count(0,'users')).toBe(users)
    expect(await count(0,'wallets')).toBe(wallets)
    const audit=await fixture.metadata.query<{company_id:string;venue_id:string;admin_id:string}>(
      "SELECT company_id::text,venue_id::text,admin_id::text FROM admin_audit_log WHERE action='crm.manual_contact_create_request' ORDER BY id DESC LIMIT 1")
    expect(audit.rows[0]).toMatchObject({company_id:fixture.manifests[0]!.scope.companyId,
      venue_id:fixture.manifests[0]!.scope.venueId,admin_id:'11'})
  })
  it('rejects a duplicate channel from a different request and does not expose PII across venues',async()=>{
    config.enableTenantCrmContactCreate=true
    const c=command('duplicate@fixture.invalid')
    expect((await send('owner',path(),c)).status).toBe(200)
    const duplicate=await send('owner',path(),command(c.contact.email))
    expect(duplicate.status).toBe(409)
    expect(await duplicate.json()).toMatchObject({code:'TENANT_CRM_CONTACT_DUPLICATE'})
    expect((await send('south',path(2),command(c.contact.email))).status).toBe(200)
    expect(await count(2,'spaceverse_crm_contacts')).toBe('1')
  })
})
