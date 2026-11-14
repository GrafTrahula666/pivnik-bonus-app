// @vitest-environment node
// Acceptance for a STRICTLY default-off, nonproduction active-venue CRM pilot.
// Physically separate synthetic tenant databases, no production data or activation.
import http from 'node:http'
import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest'
import {config} from '../config.js'
import {fixturePassword} from './onboarding-fixture.js'
import {tenantCrmFixture} from './tenant-crm-fixture.js'
import type {TenantCrmFixtureDatabase} from './tenant-crm-database-fixture.js'

const state=vi.hoisted(()=>({
  metadata:null as TenantCrmFixtureDatabase|null,
  targets:new Map<string,TenantCrmFixtureDatabase>(),resolutions:0,
}))
const connect=(db:TenantCrmFixtureDatabase)=>db.connect?db.connect():Promise.resolve({
  query:db.query.bind(db),release:()=>{},
})
vi.mock('../db.js',()=>{
  const db={
    query:(sql:string,params?:unknown[])=>state.metadata!.query(sql,params),
    connect:async()=>connect(state.metadata!),
  }
  return {pool:db,readPool:db,writePool:null,
    tableExists:async()=>false,productionTableExists:async()=>false}
})
vi.mock('../onboarding-database-registry.js',()=>({
  onboardingTargetRegistry:{resolveTargetDatabase:async(key:string)=>{
    state.resolutions++
    const target=state.targets.get(key)
    return target?{connect:()=>connect(target)}:null
  }},
  validateOnboardingTargetRegistry:()=>({registered:state.targets.size}),
  closeOnboardingTargetRegistry:async()=>{},
}))
describe('CHAT03 active tenant CRM pilot: signed HTTP / separate sources',()=>{
  let server:http.Server,origin='',fixture:Awaited<ReturnType<typeof tenantCrmFixture>>
  let oldNodeEnv:string,oldReadFlag:boolean,oldPilotFlag:boolean
  const sessions=new Map<string,string>()
  const path=(i:number)=>'/api/admin/venues/'+fixture.manifests[i]!.scope.venueId+'/clients'
  async function request(who:string,uri:string,method='GET'){
    return fetch(origin+uri,{method,headers:{cookie:sessions.get(who)||'',origin:config.publicOrigin}})
  }
  beforeAll(async()=>{
    fixture=await tenantCrmFixture()
    state.metadata=fixture.metadata
    fixture.manifests.forEach((manifest,i)=>state.targets.set(manifest.runtimeKey,fixture.targets[i]!))
    // Simulate ACTIVE canonical metadata in the disposable pilot only.
    // Neither the API nor production receives an activation command.
    for(const manifest of fixture.manifests)
      await fixture.metadata.query('UPDATE venues SET active=TRUE WHERE id=$1::bigint',[manifest.scope.venueId])
    oldNodeEnv=config.nodeEnv;oldReadFlag=config.enableTenantCrmReads
    oldPilotFlag=config.enableTenantCrmPilotReads
    config.nodeEnv='test'
    config.enableTenantCrmReads=true
    config.enableTenantCrmPilotReads=false
    config.publicOrigin='https://active-pilot.fixture.invalid'
    config.csrfSecret='active-pilot-fixture-secret-over-32-characters'
    const {handleApi,sendApiError}=await import('../router.js')
    server=http.createServer((req,res)=>void handleApi(req,res,new URL(req.url!,origin))
      .catch(error=>sendApiError(res,error,req)))
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
    origin='http://127.0.0.1:'+(server.address() as import('node:net').AddressInfo).port
    for(const who of ['owner','south','root']){
      const response=await fetch(origin+'/api/admin/auth/login',{method:'POST',headers:{
        origin:config.publicOrigin,'content-type':'application/json',
      },body:JSON.stringify({email:who+'@fixture.invalid',password:fixturePassword})})
      expect(response.status).toBe(200)
      sessions.set(who,response.headers.get('set-cookie')!.split(';')[0]!)
    }
  },90_000)
  afterEach(()=>{
    config.enableTenantCrmPilotReads=false
    config.nodeEnv='test'
    state.resolutions=0
  })
  afterAll(async()=>{
    if(server)await new Promise<void>(resolve=>server.close(()=>resolve()))
    for(const target of fixture?.targets||[])await target.close()
    await fixture?.metadata.close()
    config.nodeEnv=oldNodeEnv
    config.enableTenantCrmReads=oldReadFlag
    config.enableTenantCrmPilotReads=oldPilotFlag
  })
  it('defaults off, never touches source and never pretends empty data',async()=>{
    const response=await request('owner',path(0))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({code:'TENANT_CRM_PILOT_READ_DISABLED'})
    expect(state.resolutions).toBe(0)
  })
  it('serves exact owner directory, card, zero and missing wallets from isolated source',async()=>{
    config.enableTenantCrmPilotReads=true
    const result=await request('owner',path(0)+'?q=Owned&limit=25&offset=0&sort=id&direction=asc&wallet=all')
    expect(result.status).toBe(200)
    const page=await result.json()
    expect(page).toMatchObject({readStatus:'verified',runtimeStatus:'not_provisioned',
      scope:fixture.manifests[0]!.scope,q:'Owned'})
    expect(page.total).toBe('1')
    expect(page.items[0]).toMatchObject({customer:{id:'1'},wallet:{balance:'101'}})
    const zero=await request('owner',path(0)+'/6')
    expect(zero.status).toBe(200)
    expect(await zero.json()).toMatchObject({wallet:{balance:'0'}})
    const missing=await request('owner',path(0)+'/3')
    expect(missing.status).toBe(200)
    expect(await missing.json()).toMatchObject({wallet:null})
    const huge=await request('owner',path(0)+'/7')
    expect(huge.status).toBe(200)
    expect(await huge.json()).toMatchObject({wallet:{balance:'9007199254740993'}})
  })
  it('applies scope to sibling venue, other company and direct user URL',async()=>{
    config.enableTenantCrmPilotReads=true
    expect((await request('owner',path(1))).status).toBe(200)
    const sibling=await request('owner',path(1)+'/1')
    expect(sibling.status).toBe(200)
    expect(await sibling.json()).toMatchObject({wallet:{balance:'102'}})
    expect((await request('owner',path(2))).status).toBe(404)
    expect((await request('south',path(0))).status).toBe(404)
    const south=await request('south',path(2)+'/1')
    expect(south.status).toBe(200)
    expect(await south.json()).toMatchObject({wallet:{balance:'103'}})
  })
  it('rejects forged params and writes without opening a target database',async()=>{
    config.enableTenantCrmPilotReads=true
    for(const bad of ['?sort=balance','?limit=0','?q=one&q=two','?scope=other']){
      const response=await request('owner',path(0)+bad)
      expect(response.status).toBe(400)
    }
    expect(state.resolutions).toBe(0)
    const detailScope=await request('owner',path(0)+'/1?companyId=20')
    expect(detailScope.status).toBe(400)
    expect(await detailScope.json()).toMatchObject({code:'TENANT_CRM_REQUEST_SCOPE_FORBIDDEN'})
    expect((await request('owner',path(0)+'/1/extra')).status).toBe(404)
    expect(state.resolutions).toBe(0)
    expect((await request('owner',path(0),'POST')).status).toBe(403) // CSRF required even for owners
  })
  it('removes access in the same session after revoking an owner grant',async()=>{
    config.enableTenantCrmPilotReads=true
    expect((await request('owner',path(0)+'/1')).status).toBe(200)
    await fixture.metadata.query("DELETE FROM admin_company_access WHERE admin_id=11 AND company_id=10")
    try{
      expect((await request('owner',path(0)+'/1')).status).toBe(404)
      expect((await request('south',path(2)+'/1')).status).toBe(200)
    }finally{
      await fixture.metadata.query("INSERT INTO admin_company_access(admin_id,company_id,access_kind) VALUES(11,10,'owner')")
    }
  })
  it('fails closed when tenant binding mismatches or source is missing',async()=>{
    config.enableTenantCrmPilotReads=true
    const manifest=fixture.manifests[0]!
    await fixture.targets[0]!.query("UPDATE spaceverse_runtime_binding SET manifest_sha256=$1 WHERE runtime_key=$2",['0'.repeat(64),manifest.runtimeKey])
    try{
      const response=await request('owner',path(0)+'/1')
      expect(response.status).toBe(503)
      expect(JSON.stringify(await response.json())).not.toContain('Owned')
    }finally{
      await fixture.targets[0]!.query("UPDATE spaceverse_runtime_binding SET manifest_sha256=$1 WHERE runtime_key=$2",[manifest.manifestSha256,manifest.runtimeKey])
    }
    state.targets.delete(manifest.runtimeKey)
    try{
      const response=await request('owner',path(0))
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({code:'TENANT_CRM_SOURCE_NOT_CONFIGURED'})
    }finally{state.targets.set(manifest.runtimeKey,fixture.targets[0]!)}
  })
  it('limits a claimed viewer invitation to one active point and revokes its open session',async()=>{
    const invitationId='00000000-0000-4000-8000-000000000031'
    const customer=fixture.manifests[0]!
    const password=(await fixture.metadata.query<{password_hash:string}>(
      'SELECT password_hash FROM admin_accounts WHERE id=11')).rows[0]!.password_hash
    await fixture.metadata.query(`INSERT INTO admin_accounts(id,email,display_name,role,password_hash)
      VALUES(31,'invited-viewer@fixture.invalid','Invited viewer','VENUE_ADMIN',$1)`,[password])
    await fixture.metadata.query(`INSERT INTO admin_onboarding_invites(
      id,draft_id,company_id,venue_id,role,created_by_admin_id,token_hash,
      expires_at,status,claimed_at,claimed_admin_id)
      VALUES($1::uuid,$2::uuid,$3::bigint,$4::bigint,'viewer',11,$5,
        NOW()+INTERVAL '1 day','claimed',NOW(),31)`,
      [invitationId,customer.source.draftId,customer.scope.companyId,customer.scope.venueId,'c'.repeat(64)])
    await fixture.metadata.query(`INSERT INTO admin_onboarding_access(
      invitation_id,admin_id,company_id,venue_id,draft_id,role)
      VALUES($1::uuid,31,$2::bigint,$3::bigint,$4::uuid,'viewer')`,
      [invitationId,customer.scope.companyId,customer.scope.venueId,customer.source.draftId])
    config.enableTenantCrmPilotReads=true
    config.enableOnboardingInvitations=true
    try{
      const signed=await fetch(origin+'/api/admin/auth/login',{method:'POST',headers:{
        origin:config.publicOrigin,'content-type':'application/json',
      },body:JSON.stringify({email:'invited-viewer@fixture.invalid',password:fixturePassword})})
      expect(signed.status).toBe(200)
      sessions.set('invited-viewer',signed.headers.get('set-cookie')!.split(';')[0]!)
      const own=await request('invited-viewer',path(0)+'/1')
      expect(own.status).toBe(200)
      expect(await own.json()).toMatchObject({
        scope:customer.scope,customer:{id:'1'},wallet:{balance:'101'},
      })
      expect((await request('invited-viewer',path(1))).status).toBe(404)
      expect((await request('invited-viewer',path(2)+'/1')).status).toBe(404)
      expect((await request('invited-viewer',
        '/api/admin/venues/'+customer.scope.venueId+'/loyalty/manage')).status).toBe(403)
      await fixture.metadata.query('UPDATE admin_onboarding_access SET revoked_at=NOW() WHERE invitation_id=$1::uuid',[invitationId])
      expect((await request('invited-viewer',path(0)+'/1')).status).toBe(404)
      // Grant recovery is still insufficient when the original invitation was revoked.
      await fixture.metadata.query('UPDATE admin_onboarding_access SET revoked_at=NULL WHERE invitation_id=$1::uuid',[invitationId])
      await fixture.metadata.query('UPDATE admin_onboarding_invites SET revoked_at=NOW() WHERE id=$1::uuid',[invitationId])
      expect((await request('invited-viewer',path(0)+'/1')).status).toBe(404)
      expect((await request('south',path(2)+'/1')).status).toBe(200)
    }finally{config.enableOnboardingInvitations=false}
  })
  it('never enables pilot data exposure in production',async()=>{
    config.enableTenantCrmPilotReads=true
    config.nodeEnv='production'
    const response=await request('owner',path(0))
    expect(response.status).toBe(403)
    expect(state.resolutions).toBe(0)
  })
})
