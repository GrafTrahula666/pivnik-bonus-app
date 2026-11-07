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
  targets:new Map<string,TenantCrmFixtureDatabase>(),targetResolutions:0,failAuditOnce:false,
  loseAuditCommitAckOnce:false}))
const connect=(db:TenantCrmFixtureDatabase)=>db.connect?db.connect():Promise.resolve({
  query:db.query.bind(db),release:()=>{}
})
vi.mock('../db.js',()=>{
  const guarded=async(query:(sql:string,params?:unknown[])=>Promise<unknown>,
    sql:string,params?:unknown[])=>{
    if(state.failAuditOnce&&sql.startsWith('INSERT INTO admin_audit_log')){
      state.failAuditOnce=false
      throw new Error('synthetic-metadata-private-error')
    }
    const result=await query(sql,params)
    // Simulate the metadata COMMIT succeeding while its acknowledgement is lost.
    // The next signed retry must recover from durable audit evidence.
    if(state.loseAuditCommitAckOnce&&sql==='COMMIT'){
      state.loseAuditCommitAckOnce=false
      throw new Error('synthetic-metadata-commit-ack-lost')
    }
    return result
  }
  const db={query:(sql:string,params?:unknown[])=>guarded(state.metadata!.query.bind(state.metadata!),sql,params),
    connect:async()=>{
      const client=await connect(state.metadata!)
      return {query:(sql:string,params?:unknown[])=>guarded(client.query.bind(client),sql,params),
        release:()=>client.release()}
    }}
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
      // Keep the explicit migration guard and SQL in one native PG session.
      // Pool.query may otherwise allocate different clients between two calls.
      await target.exec("SET spaceverse.crm_contacts_migration='approved';\n"+sql)
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
    state.failAuditOnce=false
    state.loseAuditCommitAckOnce=false
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
    const contactsBefore=await count(0,'spaceverse_crm_contacts')
    const requestsBefore=await count(0,'spaceverse_crm_contact_create_requests')
    const auditsBefore=(await fixture.metadata.query<{n:string}>(
      "SELECT COUNT(*)::text AS n FROM admin_audit_log WHERE action='crm.manual_contact_create_request'"
    )).rows[0]!.n
    for(const method of ['PUT','PATCH','DELETE']){
      const response=await send('owner',path(),c,{method})
      expect(response.status).toBe(405)
    }
    expect(state.targetResolutions).toBe(0)
    expect(await count(0,'spaceverse_crm_contacts')).toBe(contactsBefore)
    expect(await count(0,'spaceverse_crm_contact_create_requests')).toBe(requestsBefore)
    expect((await fixture.metadata.query<{n:string}>(
      "SELECT COUNT(*)::text AS n FROM admin_audit_log WHERE action='crm.manual_contact_create_request'"
    )).rows[0]!.n).toBe(auditsBefore)
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
  it('rejects forged identity, wallet and POS attributes before tenant resolution',async()=>{
    config.enableTenantCrmContactCreate=true
    const c=command('manual-only-boundary@fixture.invalid')
    const beforeContacts=await count(0,'spaceverse_crm_contacts')
    const beforeRequests=await count(0,'spaceverse_crm_contact_create_requests')
    const auditsBefore=(await fixture.metadata.query<{n:string}>(
      "SELECT COUNT(*)::text AS n FROM admin_audit_log WHERE action='crm.manual_contact_create_request'"
    )).rows[0]!.n
    for(const forged of [
      {...c,identityStatus:'verified'},
      {...c,contact:{...c.contact,userId:'123'}},
      {...c,contact:{...c.contact,walletBalance:5000}},
      {...c,contact:{...c.contact,posCustomerId:'evotor-customer'}},
    ]){
      const response=await send('owner',path(),forged)
      expect(response.status).toBe(400)
      const denial=await response.json()
      expect(denial).toMatchObject({code:'TENANT_CRM_CONTACT_INVALID'})
      expect(JSON.stringify(denial)).not.toContain(c.contact.email)
    }
    expect(state.targetResolutions).toBe(0)
    expect(await count(0,'spaceverse_crm_contacts')).toBe(beforeContacts)
    expect(await count(0,'spaceverse_crm_contact_create_requests')).toBe(beforeRequests)
    expect((await fixture.metadata.query<{n:string}>(
      "SELECT COUNT(*)::text AS n FROM admin_audit_log WHERE action='crm.manual_contact_create_request'"
    )).rows[0]!.n).toBe(auditsBefore)
  })
  it('throttles repeated invalid create attempts before tenant resolution',async()=>{
    config.enableTenantCrmContactCreate=true
    const before=await count(0,'spaceverse_crm_contacts')
    const malformed={requestKey:'not-a-uuid',contact:{firstName:'A'}}
    for(let attempt=0;attempt<10;attempt++){
      const response=await send('owner',path(),malformed)
      expect(response.status).toBe(400)
    }
    const limited=await send('owner',path(),malformed)
    expect(limited.status).toBe(429)
    expect(await limited.json()).toMatchObject({code:'RATE_LIMITED'})
    expect(state.targetResolutions).toBe(0)
    expect(await count(0,'spaceverse_crm_contacts')).toBe(before)
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
    const auditsBefore=Number((await fixture.metadata.query<{n:string}>(
      "SELECT COUNT(*)::text AS n FROM admin_audit_log WHERE action='crm.manual_contact_create_request'"
    )).rows[0]!.n)
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
    const auditTotal=Number((await fixture.metadata.query<{n:string}>(
      "SELECT COUNT(*)::text AS n FROM admin_audit_log WHERE action='crm.manual_contact_create_request'"
    )).rows[0]!.n)
    expect(auditTotal).toBe(auditsBefore+1)
    const audit=await fixture.metadata.query<{company_id:string;venue_id:string;admin_id:string}>(
      "SELECT company_id::text,venue_id::text,admin_id::text FROM admin_audit_log WHERE action='crm.manual_contact_create_request' ORDER BY id DESC LIMIT 1")
    expect(audit.rows[0]).toMatchObject({company_id:fixture.manifests[0]!.scope.companyId,
      venue_id:fixture.manifests[0]!.scope.venueId,admin_id:'11'})
  })
  it('binds the HTTP idempotency key to its authenticated Admin actor',async()=>{
    config.enableTenantCrmContactCreate=true
    const c=command('actor-bound@fixture.invalid')
    const before=Number(await count(0,'spaceverse_crm_contacts'))
    const requestsBefore=Number(await count(0,'spaceverse_crm_contact_create_requests'))
    const created=await send('owner',path(),c)
    expect(created.status).toBe(200)
    const auditCount=async()=>Number((await fixture.metadata.query<{n:string}>(
      "SELECT COUNT(*)::text AS n FROM admin_audit_log WHERE action='crm.manual_contact_create_request'"
    )).rows[0]!.n)
    const audited=await auditCount()
    // Root is independently authorized for this draft, but must not be able
    // to replay another signed actor's successful request or read its PII.
    const foreignReplay=await send('root',path(),c)
    expect(foreignReplay.status).toBe(409)
    const denied=await foreignReplay.json()
    expect(denied).toMatchObject({code:'TENANT_CRM_CONTACT_REPLAY_CONFLICT'})
    expect(JSON.stringify(denied)).not.toContain(c.contact.email)
    expect(Number(await count(0,'spaceverse_crm_contacts'))).toBe(before+1)
    expect(Number(await count(0,'spaceverse_crm_contact_create_requests'))).toBe(requestsBefore+1)
    expect(await auditCount()).toBe(audited)
  })
  it('recovers one tenant contact after Admin audit failure by replaying the exact request key',async()=>{
    config.enableTenantCrmContactCreate=true
    const c=command('recoverable@fixture.invalid')
    const before=Number(await count(0,'spaceverse_crm_contacts'))
    const auditBefore=(await fixture.metadata.query<{n:string}>(
      "SELECT COUNT(*)::text AS n FROM admin_audit_log WHERE action='crm.manual_contact_create_request'")).rows[0]!.n
    state.failAuditOnce=true
    const uncertain=await send('owner',path(),c)
    expect(uncertain.status).toBe(503)
    expect(JSON.stringify(await uncertain.json())).not.toContain('synthetic-metadata-private-error')
    expect(Number(await count(0,'spaceverse_crm_contacts'))).toBe(before+1)
    // Recovery must survive a fresh signed session for the SAME Admin actor.
    // The tenant ledger binds the actor, not the previous session cookie.
    const reauth=await send(null,'/api/admin/auth/login',
      {email:'owner@fixture.invalid',password:fixturePassword})
    expect(reauth.status).toBe(200)
    const renewed=await reauth.json()
    const renewedHeaders={
      cookie:reauth.headers.get('set-cookie')!.split(';')[0]!,
      'x-csrf-token':renewed.csrfToken as string,
    }
    const replay=await send('owner',path(),c,{headers:renewedHeaders})
    expect(replay.status).toBe(200)
    expect((await replay.json()).requestKey).toBe(c.requestKey)
    expect(Number(await count(0,'spaceverse_crm_contacts'))).toBe(before+1)
    const auditAfter=(await fixture.metadata.query<{n:string}>(
      "SELECT COUNT(*)::text AS n FROM admin_audit_log WHERE action='crm.manual_contact_create_request'")).rows[0]!.n
    expect(Number(auditAfter)).toBe(Number(auditBefore)+1)
    const replayAgain=await send('owner',path(),c,{headers:renewedHeaders})
    expect(replayAgain.status).toBe(200)
    expect(Number(await count(0,'spaceverse_crm_contacts'))).toBe(before+1)
    const auditAgain=(await fixture.metadata.query<{n:string}>(
      "SELECT COUNT(*)::text AS n FROM admin_audit_log WHERE action='crm.manual_contact_create_request'")).rows[0]!.n
    expect(auditAgain).toBe(auditAfter)
  })
  it('rejects a changed payload after uncertain audit and recovers only the original request',async()=>{
    config.enableTenantCrmContactCreate=true
    const original=command('audit-retry-original@fixture.invalid')
    const changed=command('audit-retry-changed@fixture.invalid',original.requestKey)
    const contactsBefore=Number(await count(0,'spaceverse_crm_contacts'))
    const requestsBefore=Number(await count(0,'spaceverse_crm_contact_create_requests'))
    const auditCount=async()=>Number((await fixture.metadata.query<{n:string}>(
      "SELECT COUNT(*)::text AS n FROM admin_audit_log WHERE action='crm.manual_contact_create_request'"
    )).rows[0]!.n)
    const auditsBefore=await auditCount()

    // Tenant commit succeeds; metadata audit fails. Only the original payload
    // may reconcile this pending UUID. A changed payload must not steal it.
    state.failAuditOnce=true
    const uncertain=await send('owner',path(),original)
    expect(uncertain.status).toBe(503)
    const rejected=await send('owner',path(),changed)
    expect(rejected.status).toBe(409)
    const denial=await rejected.json()
    expect(denial).toMatchObject({code:'TENANT_CRM_CONTACT_REPLAY_CONFLICT'})
    expect(JSON.stringify(denial)).not.toContain(original.contact.email)
    expect(JSON.stringify(denial)).not.toContain(changed.contact.email)
    expect(Number(await count(0,'spaceverse_crm_contacts'))).toBe(contactsBefore+1)
    expect(Number(await count(0,'spaceverse_crm_contact_create_requests'))).toBe(requestsBefore+1)
    expect(await auditCount()).toBe(auditsBefore)

    const recovered=await send('owner',path(),original)
    expect(recovered.status).toBe(200)
    expect((await recovered.json()).requestKey).toBe(original.requestKey)
    expect(Number(await count(0,'spaceverse_crm_contacts'))).toBe(contactsBefore+1)
    expect(Number(await count(0,'spaceverse_crm_contact_create_requests'))).toBe(requestsBefore+1)
    expect(await auditCount()).toBe(auditsBefore+1)
  })

  it('recovers after metadata COMMIT succeeds but its acknowledgement is lost',async()=>{
    config.enableTenantCrmContactCreate=true
    const c=command('lost-commit-ack@fixture.invalid')
    const before=Number(await count(0,'spaceverse_crm_contacts'))
    const auditCount=async()=>Number((await fixture.metadata.query<{n:string}>(
      "SELECT COUNT(*)::text AS n FROM admin_audit_log WHERE action='crm.manual_contact_create_request'"
    )).rows[0]!.n)
    const auditsBefore=await auditCount()
    state.loseAuditCommitAckOnce=true
    const uncertain=await send('owner',path(),c)
    expect(uncertain.status).toBe(503)
    expect(JSON.stringify(await uncertain.json())).not.toContain('synthetic-metadata-commit-ack-lost')
    // Both databases committed, but the HTTP client did not receive success.
    expect(Number(await count(0,'spaceverse_crm_contacts'))).toBe(before+1)
    expect(await auditCount()).toBe(auditsBefore+1)
    const replay=await send('owner',path(),c)
    expect(replay.status).toBe(200)
    expect((await replay.json()).requestKey).toBe(c.requestKey)
    expect(Number(await count(0,'spaceverse_crm_contacts'))).toBe(before+1)
    expect(await auditCount()).toBe(auditsBefore+1)
  })
  it('rejects a duplicate channel from a different request and does not expose PII across venues',async()=>{
    config.enableTenantCrmContactCreate=true
    const c=command('duplicate@fixture.invalid')
    expect((await send('owner',path(),c)).status).toBe(200)
    const requestsBefore=Number(await count(0,'spaceverse_crm_contact_create_requests'))
    const audits=async()=>Number((await fixture.metadata.query<{n:string}>(
      "SELECT COUNT(*)::text AS n FROM admin_audit_log WHERE action='crm.manual_contact_create_request'"
    )).rows[0]!.n)
    const auditsBefore=await audits()
    const duplicate=await send('owner',path(),command(c.contact.email.toUpperCase()))
    expect(duplicate.status).toBe(409)
    const denial=await duplicate.json()
    expect(denial).toMatchObject({code:'TENANT_CRM_CONTACT_DUPLICATE'})
    expect(JSON.stringify(denial).toLowerCase()).not.toContain(c.contact.email)
    expect(Number(await count(0,'spaceverse_crm_contact_create_requests'))).toBe(requestsBefore)
    expect(await audits()).toBe(auditsBefore)
    expect((await send('south',path(2),command(c.contact.email))).status).toBe(200)
    expect(await count(2,'spaceverse_crm_contacts')).toBe('1')
  })
  it('normalizes phone-only contacts and rejects a formatted duplicate within the same venue',async()=>{
    config.enableTenantCrmContactCreate=true
    const phone='+7 (999) 333-44-55'
    const canonical='+79993334455'
    const first={requestKey:crypto.randomUUID(),
      contact:{firstName:'Мария',lastName:'Тест',phone,email:null}}
    const accepted=await send('owner',path(),first)
    expect(accepted.status).toBe(200)
    expect(await accepted.json()).toMatchObject({
      identityStatus:'unlinked',walletStatus:'not_created',
      contact:{phone:canonical,email:null,identityStatus:'unlinked',walletStatus:'not_created'},
    })
    const beforeContacts=await count(0,'spaceverse_crm_contacts')
    const beforeRequests=await count(0,'spaceverse_crm_contact_create_requests')
    const audits=async()=>Number((await fixture.metadata.query<{n:string}>(
      "SELECT COUNT(*)::text AS n FROM admin_audit_log WHERE action='crm.manual_contact_create_request'"
    )).rows[0]!.n)
    const beforeAudits=await audits()
    const duplicate=await send('owner',path(),{
      requestKey:crypto.randomUUID(),
      contact:{firstName:'Другой',lastName:null,phone:canonical,email:null},
    })
    expect(duplicate.status).toBe(409)
    const denial=await duplicate.json()
    expect(denial).toMatchObject({code:'TENANT_CRM_CONTACT_DUPLICATE'})
    expect(JSON.stringify(denial)).not.toContain(canonical)
    expect(await count(0,'spaceverse_crm_contacts')).toBe(beforeContacts)
    expect(await count(0,'spaceverse_crm_contact_create_requests')).toBe(beforeRequests)
    expect(await audits()).toBe(beforeAudits)
    // A different prepared venue owns a separate uniqueness scope.
    expect((await send('south',path(2),{
      requestKey:crypto.randomUUID(),
      contact:{firstName:'Мария',lastName:null,phone:canonical,email:null},
    })).status).toBe(200)
  })
  it('replays canonical-equivalent email, phone and UUID without a second contact or audit',async()=>{
    config.enableTenantCrmContactCreate=true
    const requestKey='ABCDEFAB-ABCD-4ABC-8ABC-ABCDEFABCDEF'
    const beforeContacts=Number(await count(0,'spaceverse_crm_contacts'))
    const beforeRequests=Number(await count(0,'spaceverse_crm_contact_create_requests'))
    const audits=async()=>Number((await fixture.metadata.query<{n:string}>(
      "SELECT COUNT(*)::text AS n FROM admin_audit_log WHERE action='crm.manual_contact_create_request'"
    )).rows[0]!.n)
    const beforeAudits=await audits()
    const first=await send('owner',path(),{
      requestKey,
      contact:{firstName:'  Мария  ',lastName:'Тест',phone:'+7 (999) 555-66-77',
        email:' Canonical.Replay@Example.INVALID '},
    })
    expect(first.status).toBe(200)
    const receipt=await first.json()
    expect(receipt.requestKey).toBe(requestKey.toLowerCase())
    expect(receipt.contact).toMatchObject({
      firstName:'Мария',phone:'+79995556677',email:'canonical.replay@example.invalid',
      identityStatus:'unlinked',walletStatus:'not_created',
    })
    const replay=await send('owner',path(),{
      requestKey:requestKey.toLowerCase(),
      contact:{firstName:'Мария',lastName:'Тест',phone:'+79995556677',
        email:'canonical.replay@example.invalid'},
    })
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual(receipt)
    expect(Number(await count(0,'spaceverse_crm_contacts'))).toBe(beforeContacts+1)
    expect(Number(await count(0,'spaceverse_crm_contact_create_requests'))).toBe(beforeRequests+1)
    expect(await audits()).toBe(beforeAudits+1)
  })

  it('uses the same UUID independently in two prepared venues of one company',async()=>{
    config.enableTenantCrmContactCreate=true
    const c=command('same-key-two-venues@fixture.invalid')
    const before=[0,1].map(()=>({contacts:0,requests:0}))
    for(const i of [0,1]){
      before[i]!.contacts=Number(await count(i,'spaceverse_crm_contacts'))
      before[i]!.requests=Number(await count(i,'spaceverse_crm_contact_create_requests'))
    }
    const first=await send('owner',path(0),c)
    const second=await send('owner',path(1),c)
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    const receipts=[await first.json(),await second.json()]
    for(const i of [0,1]){
      expect(receipts[i]).toMatchObject({requestKey:c.requestKey,
        identityStatus:'unlinked',walletStatus:'not_created',
        contact:{email:c.contact.email,identityStatus:'unlinked',walletStatus:'not_created'}})
      expect(Number(await count(i,'spaceverse_crm_contacts'))).toBe(before[i]!.contacts+1)
      expect(Number(await count(i,'spaceverse_crm_contact_create_requests'))).toBe(before[i]!.requests+1)
      const replay=await send('owner',path(i),c)
      expect(replay.status).toBe(200)
      expect(await replay.json()).toEqual(receipts[i])
    }
    const audit=await fixture.metadata.query<{company_id:string;venue_id:string;admin_id:string}>(
      `SELECT company_id::text,venue_id::text,admin_id::text FROM admin_audit_log
       WHERE action='crm.manual_contact_create_request' AND metadata->>'requestKey'=$1`,
      [c.requestKey])
    expect(audit.rows).toHaveLength(2)
    expect(new Set(audit.rows.map(row=>row.venue_id))).toEqual(new Set([
      fixture.manifests[0]!.scope.venueId,fixture.manifests[1]!.scope.venueId,
    ]))
    for(const row of audit.rows)expect(row).toMatchObject({company_id:'10',admin_id:'11'})
  })

  // Native PostgreSQL only: PGlite's single connection cannot model two
  // independent HTTP transactions waiting on the same Admin draft lock.
  it.skipIf(!process.env.SPACEVERSE_TEST_NATIVE_POSTGRES_URL)(
    'two concurrent signed owner POSTs with the same email create one contact and one audit',
    async()=>{
      config.enableTenantCrmContactCreate=true
      const email='simultaneous-tabs@fixture.invalid'
      const beforeContacts=Number(await count(0,'spaceverse_crm_contacts'))
      const beforeRequests=Number(await count(0,'spaceverse_crm_contact_create_requests'))
      const audits=async()=>Number((await fixture.metadata.query<{n:string}>(
        "SELECT COUNT(*)::text AS n FROM admin_audit_log WHERE action='crm.manual_contact_create_request'"
      )).rows[0]!.n)
      const beforeAudits=await audits()
      // Distinct UUIDs simulate separate tabs; only the normalized channel
      // is shared. Neither tab may bypass the tenant unique index or audit.
      const [first,second]=await Promise.all([
        send('owner',path(),command(email)),
        send('owner',path(),command(email.toUpperCase())),
      ])
      expect([first.status,second.status].sort((a,b)=>a-b)).toEqual([200,409])
      const rejected=first.status===409?first:second
      expect(await rejected.json()).toMatchObject({code:'TENANT_CRM_CONTACT_DUPLICATE'})
      expect(Number(await count(0,'spaceverse_crm_contacts'))).toBe(beforeContacts+1)
      expect(Number(await count(0,'spaceverse_crm_contact_create_requests'))).toBe(beforeRequests+1)
      expect(await audits()).toBe(beforeAudits+1)
    },30_000)

  // Native PostgreSQL exercises independent connections and the real draft
  // row lock. Two simultaneous retries of one UUID must share one receipt.
  it.skipIf(!process.env.SPACEVERSE_TEST_NATIVE_POSTGRES_URL)(
    'two concurrent signed owner POSTs with one request UUID create one contact and audit',
    async()=>{
      config.enableTenantCrmContactCreate=true
      const c=command('simultaneous-replay@fixture.invalid')
      const beforeContacts=Number(await count(0,'spaceverse_crm_contacts'))
      const beforeRequests=Number(await count(0,'spaceverse_crm_contact_create_requests'))
      const audits=async()=>Number((await fixture.metadata.query<{n:string}>(
        "SELECT COUNT(*)::text AS n FROM admin_audit_log WHERE action='crm.manual_contact_create_request'"
      )).rows[0]!.n)
      const beforeAudits=await audits()
      const [first,second]=await Promise.all([
        send('owner',path(),c),
        send('owner',path(),c),
      ])
      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(await first.json()).toEqual(await second.json())
      expect(Number(await count(0,'spaceverse_crm_contacts'))).toBe(beforeContacts+1)
      expect(Number(await count(0,'spaceverse_crm_contact_create_requests'))).toBe(beforeRequests+1)
      expect(await audits()).toBe(beforeAudits+1)
    },30_000)

  // Native PostgreSQL must serialize competing payloads that reuse one UUID.
  // Only the first payload can own the durable receipt; the other fails closed.
  it.skipIf(!process.env.SPACEVERSE_TEST_NATIVE_POSTGRES_URL)(
    'two concurrent signed owner POSTs with one UUID but different payloads reject replay',
    async()=>{
      config.enableTenantCrmContactCreate=true
      const firstCommand=command('same-key-first@fixture.invalid')
      const secondCommand=command('same-key-second@fixture.invalid',firstCommand.requestKey)
      const beforeContacts=Number(await count(0,'spaceverse_crm_contacts'))
      const beforeRequests=Number(await count(0,'spaceverse_crm_contact_create_requests'))
      const audits=async()=>Number((await fixture.metadata.query<{n:string}>(
        "SELECT COUNT(*)::text AS n FROM admin_audit_log WHERE action='crm.manual_contact_create_request'"
      )).rows[0]!.n)
      const beforeAudits=await audits()
      const [first,second]=await Promise.all([
        send('owner',path(),firstCommand),
        send('owner',path(),secondCommand),
      ])
      expect([first.status,second.status].sort((a,b)=>a-b)).toEqual([200,409])
      const accepted=first.status===200?first:second
      const rejected=first.status===409?first:second
      expect((await accepted.json()).requestKey).toBe(firstCommand.requestKey)
      const denial=await rejected.json()
      expect(denial).toMatchObject({code:'TENANT_CRM_CONTACT_REPLAY_CONFLICT'})
      expect(JSON.stringify(denial)).not.toContain(firstCommand.contact.email)
      expect(JSON.stringify(denial)).not.toContain(secondCommand.contact.email)
      expect(Number(await count(0,'spaceverse_crm_contacts'))).toBe(beforeContacts+1)
      expect(Number(await count(0,'spaceverse_crm_contact_create_requests'))).toBe(beforeRequests+1)
      expect(await audits()).toBe(beforeAudits+1)
    },30_000)

})
