// @vitest-environment node
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest'
import {config} from '../config.js'
import {fixturePassword} from './onboarding-fixture.js'
import {tenantCrmFixture} from './tenant-crm-fixture.js'
import type {TenantCrmFixtureDatabase} from './tenant-crm-database-fixture.js'

const state=vi.hoisted(()=>({db:null as TenantCrmFixtureDatabase|null,failAudit:false,beforeAccountCheck:null as (()=>Promise<void>)|null}))
vi.mock('../db.js',()=>{
  const execute=async(db:Pick<TenantCrmFixtureDatabase,'query'>,text:string,params?:unknown[])=>{
    if(state.failAudit&&text.startsWith('INSERT INTO admin_audit_log'))throw new Error('synthetic-private-credential-do-not-expose')
    if(text.startsWith('SELECT id FROM admin_accounts WHERE')&&state.beforeAccountCheck){
      const action=state.beforeAccountCheck;state.beforeAccountCheck=null;await action()
    }
    const result=await db.query(text,params);return {...result,rowCount:result.affectedRows??result.rows.length}
  }
  const query=(text:string,params?:unknown[])=>execute(state.db!,text,params)
  const pool={query,connect:async()=>{
    const client=state.db!.connect?await state.db!.connect():{query:state.db!.query.bind(state.db!),release(){}}
    return {query:(text:string,params?:unknown[])=>execute(client,text,params),release:()=>client.release()}
  }}
  return {pool,readPool:pool,writePool:null,tableExists:async()=>false,productionTableExists:async()=>false}
})

describe('onboarding support: real signed HTTP and canonical SQL',()=>{
  let server:http.Server,origin:string,fixture:Awaited<ReturnType<typeof tenantCrmFixture>>
  const sessions=new Map<string,{cookie:string;csrf:string}>()
  const path=(index=0)=>`/api/admin/onboarding/drafts/${fixture.manifests[index]!.source.draftId}/support`
  function request(who:string|null,target=path(),body?:unknown,headers:Record<string,string>={}){
    const session=who?sessions.get(who):undefined
    return fetch(origin+target,{method:body===undefined?'GET':'POST',headers:{...(session?{cookie:session.cookie}:{}),
      ...(body===undefined?{}:{origin:config.publicOrigin,'content-type':'application/json','x-csrf-token':session?.csrf??''}),...headers},
    ...(body===undefined?{}:{body:JSON.stringify(body)})})
  }
  beforeAll(async()=>{
    expect(config.enableOnboardingSupport).toBe(false)
    config.enableWrites=config.enableOnboardingDrafts=config.enableOnboardingInvitations=config.enableOnboardingSupport=true
    config.publicOrigin='https://support.fixture.invalid';config.csrfSecret='synthetic-support-csrf-secret-1234567890'
    fixture=await tenantCrmFixture();state.db=fixture.metadata
    const {handleApi,sendApiError}=await import('../router.js')
    server=http.createServer((req,res)=>{void handleApi(req,res,new URL(req.url!,origin)).catch(error=>sendApiError(res,error,req))})
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
    origin=`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
    for(const who of ['root','other-root','owner','trusted','south']){
      const result=await fetch(origin+'/api/admin/auth/login',{method:'POST',headers:{origin:config.publicOrigin,'content-type':'application/json'},
        body:JSON.stringify({email:who+'@fixture.invalid',password:fixturePassword})})
      expect(result.status).toBe(200)
      sessions.set(who,{cookie:result.headers.get('set-cookie')!.split(';')[0]!,csrf:(await result.json()).csrfToken})
    }
  },60_000)
  afterEach(async()=>{
    config.enableOnboardingSupport=config.enableOnboardingInvitations=true;state.failAudit=false;state.beforeAccountCheck=null
    await state.db!.query("UPDATE admin_onboarding_access SET role='manager',revoked_at=NULL WHERE invitation_id=$1",[fixture.viewerInvite])
    await state.db!.query("UPDATE admin_company_access SET access_kind='owner' WHERE admin_id=11 AND company_id=10")
    await state.db!.query('UPDATE admin_accounts SET active=TRUE WHERE id=12')
    await state.db!.query("UPDATE admin_accounts SET role='SUPER_ADMIN' WHERE id=1")
    const {__resetRateLimitBucketsForTests}=await import('../security.js');__resetRateLimitBucketsForTests()
  })
  afterAll(async()=>{
    if(server)await new Promise<void>(resolve=>server.close(()=>resolve()))
    for(const db of fixture?.targets??[])await db.close()
    await state.db?.close()
  })
  it('requires signed login and is default-off for both the owner and operator queue',async()=>{
    expect((await request(null)).status).toBe(401)
    config.enableOnboardingSupport=false
    expect((await request('owner')).status).toBe(403)
    expect((await request('owner',path(),{topic:'connection'})).status).toBe(403)
    expect((await request('root','/api/admin/onboarding/support')).status).toBe(403)
    expect((await state.db!.query('SELECT * FROM admin_onboarding_support_requests')).rows).toHaveLength(0)
  })
  it('separates two venues of one company and another owner without restricting the company owner',async()=>{
    const ids=[]
    for(const [index,who] of ['owner','owner','south'].entries()){
      const result=await request(who,path(index),{topic:'connection'});expect(result.status).toBe(200)
      const body=await result.json();expect(body).toMatchObject({schemaVersion:1,draftId:fixture.manifests[index]!.source.draftId,
        scope:fixture.manifests[index]!.scope,delivery:'internal_queue',externalNotificationSent:false,
        requests:[{topic:'connection',status:'recorded'}]});ids.push(body.requests[0].id)
      expect((await (await request(who,path(index))).json()).requests[0].id).toBe(ids[index])
    }
    expect(new Set(ids).size).toBe(3)
    expect((await request('owner',path(2))).status).toBe(404)
    expect((await request('south')).status).toBe(404)
    expect((await request('other-root')).status).toBe(404)
  })
  it('limits a manager to their draft and rejects viewer, revoked grant and inactive account',async()=>{
    expect((await request('trusted',path(),{topic:'access'})).status).toBe(200)
    expect((await request('trusted',path(1))).status).toBe(404)
    await state.db!.query("UPDATE admin_onboarding_access SET role='viewer' WHERE invitation_id=$1",[fixture.viewerInvite])
    expect((await request('trusted')).status).toBe(403)
    expect((await request('trusted',path(),{topic:'connection'})).status).toBe(403)
    await state.db!.query("UPDATE admin_onboarding_access SET role='manager',revoked_at=NOW() WHERE invitation_id=$1",[fixture.viewerInvite])
    expect((await request('trusted')).status).toBe(403)
    await state.db!.query('UPDATE admin_accounts SET active=FALSE WHERE id=12')
    expect((await request('trusted')).status).toBe(401)
  })
  it('does not retain creator access when an independent company grant is revoked',async()=>{
    await state.db!.query("UPDATE admin_company_access SET access_kind='trusted' WHERE admin_id=11 AND company_id=10")
    expect((await request('owner')).status).toBe(403)
    expect((await request('owner',path(),{topic:'activation'})).status).toBe(403)
  })
  it('rechecks a demotion between signed session loading and the transaction account lock',async()=>{
    config.enableOnboardingInvitations=false
    state.beforeAccountCheck=async()=>{await state.db!.query("UPDATE admin_accounts SET role='VENUE_ADMIN' WHERE id=1")}
    expect((await request('root',path(),{topic:'activation'})).status).toBe(403)
    expect((await state.db!.query("SELECT id FROM admin_onboarding_support_requests WHERE draft_id=$1 AND topic='activation'",[fixture.manifests[0]!.source.draftId])).rows).toHaveLength(0)
  })
  it('retains every company-owner grant alongside an unrelated store-scoped invitation',async()=>{
    await state.db!.query("INSERT INTO admin_company_access(admin_id,company_id,access_kind) VALUES(11,20,'owner') ON CONFLICT(admin_id,company_id) DO UPDATE SET access_kind='owner'")
    try{
      for(const index of [0,1,2])expect((await request('owner',path(index))).status).toBe(200)
    }finally{await state.db!.query("UPDATE admin_company_access SET access_kind='trusted' WHERE admin_id=11 AND company_id=20")}
  })
  it('rejects scope, status, free text, secrets, unrecognized topics and query injection',async()=>{
    for(const body of [null,[],{}, {topic:'unknown'},...['companyId','venueId','status','message','token','requestKey'].map(key=>({topic:'connection',[key]:'private-value'}))]){
      expect((await request('owner',path(),body)).status).toBe(400)
    }
    for(const query of ['?companyId=20','?topic=connection','?offset=0&offset=1'])expect((await request('owner',path()+query)).status).toBe(400)
    expect((await request('owner','/api/admin/onboarding/drafts/not-a-uuid/support')).status).toBe(400)
    expect(JSON.stringify((await state.db!.query('SELECT * FROM admin_onboarding_support_requests')).rows)).not.toContain('private-value')
  })
  it('requires Origin and CSRF for writes and enforces an actor-wide rate limit',async()=>{
    expect((await request('owner',path(),{topic:'activation'},{'x-csrf-token':''})).status).toBe(403)
    expect((await request('owner',path(),{topic:'activation'},{origin:'https://foreign.fixture.invalid'})).status).toBe(403)
    for(let i=0;i<30;i++)expect((await request('owner')).status).toBe(200)
    expect((await request('owner',path(1))).status).toBe(429)
  })
  it('deduplicates concurrent commands and reloads with exactly one atomic scoped audit',async()=>{
    const responses=state.db!.connect?await Promise.all(Array.from({length:6},()=>request('owner',path(),{topic:'customer_data'}))):
      [await request('owner',path(),{topic:'customer_data'}),await request('owner',path(),{topic:'customer_data'})]
    const bodies=[]
    for(const response of responses){expect(response.status).toBe(200);bodies.push(await response.json())}
    const ids=bodies.map(body=>body.requests.find((row:{topic:string})=>row.topic==='customer_data').id)
    expect(new Set(ids).size).toBe(1)
    const audits=await state.db!.query<{company_id:string;venue_id:string}>("SELECT company_id::text,venue_id::text FROM admin_audit_log WHERE action='onboarding.support_recorded' AND entity_id=$1",[ids[0]])
    expect(audits.rows).toEqual([{company_id:'10',venue_id:fixture.manifests[0]!.scope.venueId}])
    expect((await (await request('trusted')).json()).requests.find((row:{topic:string})=>row.topic==='customer_data').id).toBe(ids[0])
  })
  it('rolls back creation when audit fails without leaking private exception text',async()=>{
    state.failAudit=true
    const result=await request('owner',path(),{topic:'activation'});expect(result.status).toBe(503)
    expect(await result.text()).not.toContain('synthetic-private')
    const rows=await state.db!.query("SELECT id FROM admin_onboarding_support_requests WHERE draft_id=$1 AND topic='activation'",[fixture.manifests[0]!.source.draftId])
    expect(rows.rows).toHaveLength(0)
    state.failAudit=false;expect((await request('owner',path(),{topic:'activation'})).status).toBe(200)
  })
  it('fails explicitly when the manual migration is missing and remains disabled without touching its table',async()=>{
    await state.db!.exec('ALTER TABLE admin_onboarding_support_requests RENAME TO support_fixture_retained')
    try{
      expect((await request('owner')).status).toBe(503)
      config.enableOnboardingSupport=false;expect((await request('owner')).status).toBe(403)
    }finally{await state.db!.exec('ALTER TABLE support_fixture_retained RENAME TO admin_onboarding_support_requests')}
    await state.db!.exec(await fs.readFile(new URL('../../admin-migrations/017_onboarding_support.sql',import.meta.url),'utf8'))
  })
  it('refuses an inconsistent canonical company/venue binding before returning tickets',async()=>{
    const manifest=fixture.manifests[0]!
    await state.db!.query('UPDATE admin_onboarding_scopes SET company_id=20 WHERE draft_id=$1',[manifest.source.draftId])
    try{expect((await request('owner')).status).toBe(409)}
    finally{await state.db!.query('UPDATE admin_onboarding_scopes SET company_id=10 WHERE draft_id=$1',[manifest.source.draftId])}
  })
  it('never exposes the platform queue to business owners or managers; operator reads are audited',async()=>{
    for(const who of ['owner','trusted','south'])expect((await request(who,'/api/admin/onboarding/support')).status).toBe(403)
    const result=await request('root','/api/admin/onboarding/support');expect(result.status).toBe(200)
    const body=await result.json();expect(body.requests.length).toBeGreaterThan(0)
    expect(body.requests.every((row:{status:string})=>row.status==='recorded')).toBe(true)
    expect(JSON.stringify(body)).not.toMatch(/password|token|email|balance|ciphertext/)
    expect((await state.db!.query("SELECT id FROM admin_audit_log WHERE action='onboarding.support_queue_read'")).rows).toHaveLength(1)
    for(const query of ['?companyId=10','?offset=-1','?offset=0&offset=1','?offset=1000000'])
      expect((await request('root','/api/admin/onboarding/support'+query)).status).toBe(400)
  })
  it('paginates more than 25 queue entries without dropping or duplicating requests',async()=>{
    for(let i=0;i<7;i++){
      const draft=crypto.randomUUID(),venue=(await state.db!.query<{id:string}>("INSERT INTO venues(company_id,code,name,active) VALUES(10,$1,'Queue fixture',FALSE) RETURNING id::text",[draft])).rows[0]!.id
      await state.db!.query(`INSERT INTO admin_onboarding_drafts(id,admin_id,company_id,request_key,initial_hash,data)
        SELECT $1,1,10,$2,initial_hash,data FROM admin_onboarding_drafts WHERE id=$3`,[draft,crypto.randomUUID(),fixture.manifests[0]!.source.draftId])
      await state.db!.query('INSERT INTO admin_onboarding_scopes(draft_id,company_id,venue_id,company_created_by_onboarding,draft_revision,application_revision) VALUES($1,10,$2,FALSE,1,1)',[draft,venue])
      for(const topic of ['connection','access','customer_data','activation'])await state.db!.query('INSERT INTO admin_onboarding_support_requests(id,draft_id,created_by_admin_id,topic) VALUES($1,$2,1,$3)',[crypto.randomUUID(),draft,topic])
    }
    const first=await (await request('root','/api/admin/onboarding/support')).json()
    expect(first.requests).toHaveLength(25);expect(first.nextOffset).toBe(25)
    const second=await (await request('root','/api/admin/onboarding/support?offset=25')).json()
    expect(second.nextOffset).toBe(null)
    const ids=[...first.requests,...second.requests].map((row:{id:string})=>row.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe((await state.db!.query('SELECT id FROM admin_onboarding_support_requests')).rows.length)
    state.failAudit=true;expect((await request('root','/api/admin/onboarding/support')).status).toBe(503)
  })
})
