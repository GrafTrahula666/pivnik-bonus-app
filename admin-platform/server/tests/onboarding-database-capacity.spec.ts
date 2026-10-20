// @vitest-environment node
import http from 'node:http'
import type {Pool} from 'pg'
import {afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest'
import {config} from '../config.js'
import {createOnboardingTargetRegistry} from '../onboarding-database-registry.js'
import {readAllocatedDatabaseSlot,reserveDatabaseSlot} from '../onboarding-database-capacity.js'
import {createOnboardingProvisioningService} from '../onboarding-provisioning.js'
import {emptyTenantFixture} from './empty-tenant-fixture.js'
import {fixturePassword} from './onboarding-fixture.js'
import type {TenantCrmFixtureDatabase} from './tenant-crm-database-fixture.js'

const state=vi.hoisted(()=>({db:null as TenantCrmFixtureDatabase|null,failAudit:false,
  registry:null as ReturnType<typeof createOnboardingTargetRegistry>|null}))
function database(db:TenantCrmFixtureDatabase):Pick<Pool,'connect'>{
  return {connect:async()=>{
    const client=db.connect?await db.connect():{query:db.query.bind(db),release(){}}
    return {release:()=>client.release(),async query(text:string,params?:unknown[]){
      if(state.failAudit&&text.startsWith('INSERT INTO admin_audit_log'))throw new Error('synthetic-private-credential')
      if(!db.connect&&!params&&/CREATE TABLE|ALTER TABLE|DO \$\$/.test(text)){await db.exec(text);return {rows:[],rowCount:0}}
      const result=await client.query(text,params);return {...result,rowCount:result.affectedRows??result.rows.length}
    }}
  }} as unknown as Pick<Pool,'connect'>
}
vi.mock('../db.js',()=>{
  const pool={query:(text:string,params?:unknown[])=>state.db!.query(text,params),connect:async()=>database(state.db!).connect()}
  return {pool,readPool:pool,writePool:null,tableExists:async()=>false,productionTableExists:async()=>false}
})
vi.mock('../onboarding-database-registry.js',async original=>{
  const actual=await original<typeof import('../onboarding-database-registry.js')>()
  return {...actual,onboardingTargetRegistry:{
    hasExplicitTarget:(key:string)=>state.registry!.hasExplicitTarget(key),
    capacitySlots:()=>state.registry!.capacitySlots(),
    resolveTargetDatabase:(key:string)=>state.registry!.resolveTargetDatabase(key),
  }}
})
const owner={id:'11',email:'owner@fixture.invalid',displayName:'owner',role:'VENUE_ADMIN' as const}
const manager={id:'12',email:'trusted@fixture.invalid',displayName:'trusted',role:'VENUE_ADMIN' as const}

describe('database capacity: canonical binding claim, SQL allocation and existing bootstrap',()=>{
  let fixture:Awaited<ReturnType<typeof emptyTenantFixture>>,env:NodeJS.ProcessEnv
  beforeAll(()=>{expect(config.enableOnboardingDatabaseCapacity).toBe(false)})
  beforeEach(async()=>{
    config.enableWrites=config.enableOnboardingDrafts=config.enableOnboardingInvitations=config.enableOnboardingProvisioning=true
    config.enableOnboardingDatabaseBootstrap=config.enableOnboardingDatabaseCapacity=config.enableCrmOnboarding=true
    fixture=await emptyTenantFixture(1,true);state.db=fixture.metadata
    // PGlite starts lazily: boot isolated targets in setup, before the normal
    // operation watchdog, without extending or weakening the test assertions.
    await Promise.all(fixture.targets.map(target=>target.query('SELECT 1')))
    env={ADMIN_ENABLE_ONBOARDING_DATABASE_CAPACITY:'true',ADMIN_ONBOARDING_DATABASE_CAPACITY_JSON:JSON.stringify(Object.fromEntries(
      fixture.targets.map((_,i)=>['capacity-'+i,{credentialEnv:'SPACEVERSE_TENANT_DATABASE_URL_SLOT_'+i}])))}
    const byUrl=new Map<string,TenantCrmFixtureDatabase>()
    fixture.targets.forEach((target,i)=>{
      const url=target.connectionString??'postgresql://crm_fixture:synthetic@127.0.0.1/codex_admin_test_slot_'+i
      env['SPACEVERSE_TENANT_DATABASE_URL_SLOT_'+i]=url;byUrl.set(url,target)
    })
    state.registry=createOnboardingTargetRegistry({env,resolveAllocation:readAllocatedDatabaseSlot,poolFactory:options=>{
      const target=byUrl.get(String(options.connectionString))!
      return {...database(target),end:async()=>{}} as never
    }})
  },60_000)
  afterEach(async()=>{
    state.failAudit=false;await state.registry?.close()
    for(const db of fixture?.targets??[])await db.close()
    await fixture?.metadata.close()
  })
  const draft=(i=0)=>fixture.manifests[i]!.source.draftId
  const allocations=async()=>(await fixture.metadata.query(`SELECT draft_id::text,runtime_key,slot_key,target_fingerprint,
    company_id::text,venue_id::text FROM admin_onboarding_database_allocations ORDER BY slot_key`)).rows
  const tables=async(i=0)=>(await fixture.targets[i]!.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows
  const service=(afterTargetCommit?:()=>Promise<void>)=>createOnboardingProvisioningService({
    metadata:database(fixture.metadata),allowEmptyDatabaseBootstrap:true,afterTargetCommit,
    resolveTargetDatabase:key=>state.registry!.resolveTargetDatabase(key),
    reserveTargetDatabase:(client,admin,source)=>reserveDatabaseSlot(client,admin,source,state.registry!.capacitySlots()),
  })

  it('GET and plain registry reads never allocate; one POST prepares a database without per-runtime environment edits',async()=>{
    const provisioner=service()
    expect(await state.registry!.resolveTargetDatabase(fixture.manifests[0]!.runtimeKey)).toBeNull()
    expect(await provisioner.getRuntimeDatabaseBinding(owner,draft())).toMatchObject({status:'not_started'})
    expect(await allocations()).toEqual([]);expect(await tables()).toEqual([])
    const first=await provisioner.runRuntimeDatabaseBinding(owner,draft())
    expect(first).toMatchObject({status:'succeeded',result:{binding:'created'}})
    expect(await provisioner.runTenantSchemaReadiness(owner,draft())).toMatchObject({status:'succeeded'})
    expect(await provisioner.runRuntimeDatabaseBinding(owner,draft())).toEqual(first)
    expect(await allocations()).toHaveLength(1)
    expect(env.ADMIN_ONBOARDING_DATABASE_REGISTRY_JSON).toBeUndefined()
    expect(JSON.stringify(first)).not.toMatch(/credentialEnv|slot_key|target_fingerprint|postgres|synthetic/)
    expect((await fixture.metadata.query("SELECT COUNT(*)::text AS count FROM admin_audit_log WHERE action='onboarding.database_capacity_reserved'")).rows).toEqual([{count:'1'}])
  })
  it('allocates unique physical databases to two same-company venues and a different company under concurrent native requests',async()=>{
    const provisioner=service()
    const results=fixture.metadata.connect
      ?await Promise.all([0,1,2].map(i=>provisioner.runRuntimeDatabaseBinding(owner,draft(i))))
      :await (async()=>{const values=[];for(const i of [0,1,2])values.push(await provisioner.runRuntimeDatabaseBinding(owner,draft(i)));return values})()
    expect(results.every(row=>row.status==='succeeded')).toBe(true)
    const rows=await allocations();expect(rows).toHaveLength(3)
    expect(new Set(rows.map(row=>row.slot_key)).size).toBe(3)
    expect(new Set(rows.map(row=>row.target_fingerprint)).size).toBe(3)
    for(let i=0;i<3;i++){
      const allocated=await readAllocatedDatabaseSlot(fixture.manifests[i]!.runtimeKey)
      const target=Number(allocated!.slotKey.slice('capacity-'.length))
      expect((await fixture.targets[target]!.query('SELECT runtime_key,company_id,venue_id FROM spaceverse_runtime_binding')).rows)
        .toEqual([{runtime_key:fixture.manifests[i]!.runtimeKey,company_id:fixture.manifests[i]!.scope.companyId,venue_id:fixture.manifests[i]!.scope.venueId}])
    }
  })
  it('does not double-assign the last slot and returns an honest resumable wait to the other draft',async()=>{
    delete env.SPACEVERSE_TENANT_DATABASE_URL_SLOT_1;delete env.SPACEVERSE_TENANT_DATABASE_URL_SLOT_2
    const provisioner=service()
    const first=provisioner.runRuntimeDatabaseBinding(owner,draft())
    const results=fixture.metadata.connect?await Promise.all([first,provisioner.runRuntimeDatabaseBinding(owner,draft(1))]):
      [await first,await provisioner.runRuntimeDatabaseBinding(owner,draft(1))]
    expect(results.map(row=>row.status).sort()).toEqual(['action_required','succeeded'])
    expect(results.find(row=>row.status==='action_required')).toMatchObject({errorCode:'TARGET_DATABASE_CAPACITY_EXHAUSTED',startAllowed:true,result:null})
    expect(await allocations()).toHaveLength(1)
  })
  it('a missing secret waits without touching targets, and retry consumes newly available capacity for the same frozen scope',async()=>{
    const saved=String(env.SPACEVERSE_TENANT_DATABASE_URL_SLOT_0)
    delete env.SPACEVERSE_TENANT_DATABASE_URL_SLOT_0;delete env.SPACEVERSE_TENANT_DATABASE_URL_SLOT_1;delete env.SPACEVERSE_TENANT_DATABASE_URL_SLOT_2
    const provisioner=service()
    expect(await provisioner.runRuntimeDatabaseBinding(owner,draft())).toMatchObject({status:'action_required',errorCode:'TARGET_DATABASE_CAPACITY_EXHAUSTED'})
    expect(await allocations()).toEqual([]);expect(await tables()).toEqual([])
    config.enableOnboardingWorkflow=true
    const {getOnboardingWorkflow}=await import('../onboarding-workflow.js')
    expect((await getOnboardingWorkflow(owner,draft())).steps.find(step=>step.id==='provisioning'))
      .toMatchObject({status:'pending',code:'TARGET_DATABASE_CAPACITY_EXHAUSTED'})
    env.SPACEVERSE_TENANT_DATABASE_URL_SLOT_0=saved
    expect(await provisioner.runRuntimeDatabaseBinding(owner,draft())).toMatchObject({status:'succeeded',attemptCount:2})
  })
  it('audit failure rolls back allocation and claim before any target operation',async()=>{
    state.failAudit=true
    await expect(service().runRuntimeDatabaseBinding(owner,draft())).rejects.toMatchObject({statusCode:503})
    expect(await allocations()).toEqual([]);expect(await tables()).toEqual([])
    expect((await fixture.metadata.query('SELECT * FROM admin_onboarding_provisioning_steps')).rows).toEqual([])
    state.failAudit=false
    expect(await service().runRuntimeDatabaseBinding(owner,draft())).toMatchObject({status:'succeeded',attemptCount:1})
  })
  it('without the capacity command capability never reserves on a missing runtime target',async()=>{
    const provisioner=createOnboardingProvisioningService({metadata:database(fixture.metadata),allowEmptyDatabaseBootstrap:true,
      resolveTargetDatabase:key=>state.registry!.resolveTargetDatabase(key)})
    expect(await provisioner.runRuntimeDatabaseBinding(owner,draft())).toMatchObject({status:'action_required',errorCode:'TARGET_DATABASE_NOT_REGISTERED'})
    expect(await allocations()).toEqual([]);expect(await tables()).toEqual([])
  })
  it('rejects a corrupted frozen-source reservation instead of assigning another free slot',async()=>{
    await service(async()=>{throw new Error('lost-reply')}).runRuntimeDatabaseBinding(owner,draft())
    await fixture.metadata.query('UPDATE admin_onboarding_database_allocations SET manifest_sha256=$1',['0'.repeat(64)])
    await expect(service().runRuntimeDatabaseBinding(owner,draft())).rejects.toMatchObject({statusCode:409,code:'ONBOARDING_DATABASE_CAPACITY_SOURCE_CHANGED'})
    expect(await allocations()).toHaveLength(1);expect(await tables(1)).toEqual([])
  })
  it('readonly lookup rejects stale application revision without allocating replacement capacity',async()=>{
    await service().runRuntimeDatabaseBinding(owner,draft())
    await fixture.metadata.query('UPDATE admin_onboarding_app_configs SET revision=revision+1 WHERE draft_id=$1',[draft()])
    expect(await readAllocatedDatabaseSlot(fixture.manifests[0]!.runtimeKey)).toBeNull()
    expect(await state.registry!.resolveTargetDatabase(fixture.manifests[0]!.runtimeKey)).toBeNull()
    expect(await allocations()).toHaveLength(1);expect(await tables(1)).toEqual([])
  })
  it('reconciles committed target after a lost reply without reserving another slot',async()=>{
    expect(await service(async()=>{throw new Error('synthetic-private-credential')}).runRuntimeDatabaseBinding(owner,draft()))
      .toMatchObject({status:'retryable_error',errorCode:'TARGET_CONFIRMATION_UNCERTAIN'})
    const rows=await allocations()
    expect(await service().runRuntimeDatabaseBinding(owner,draft())).toMatchObject({status:'succeeded',attemptCount:2,result:{binding:'verified_existing'}})
    expect(await allocations()).toEqual(rows)
  })
  it('never silently retargets an allocation when a credential reference is redirected to a different database',async()=>{
    await service(async()=>{throw new Error('lost-reply')}).runRuntimeDatabaseBinding(owner,draft())
    const rows=await allocations()
    env.SPACEVERSE_TENANT_DATABASE_URL_SLOT_0='postgres://crm_fixture:synthetic@127.0.0.1/changed_database'
    expect(await service().runRuntimeDatabaseBinding(owner,draft())).toMatchObject({status:'action_required',errorCode:'TARGET_DATABASE_CAPACITY_UNAVAILABLE'})
    expect(await allocations()).toEqual(rows);expect(await tables(1)).toEqual([])
  })
  it('rejects foreign manager, viewer and revoked actor before reserving a resource',async()=>{
    await expect(service().runRuntimeDatabaseBinding(manager,draft(1))).rejects.toMatchObject({statusCode:404})
    await fixture.metadata.exec("UPDATE admin_onboarding_access SET role='viewer'")
    await expect(service().runRuntimeDatabaseBinding(manager,draft())).rejects.toMatchObject({statusCode:403})
    await fixture.metadata.exec('UPDATE admin_accounts SET active=FALSE WHERE id=11')
    await expect(service().runRuntimeDatabaseBinding(owner,draft())).rejects.toMatchObject({statusCode:403})
    expect(await allocations()).toEqual([]);expect(await tables()).toEqual([])
  })
  it('does not adopt a nonempty capacity database or recycle its reservation automatically',async()=>{
    await fixture.targets[0]!.exec('CREATE TABLE existing_business(id INT PRIMARY KEY); INSERT INTO existing_business VALUES(7)')
    expect(await service().runRuntimeDatabaseBinding(owner,draft())).toMatchObject({status:'action_required',errorCode:'TARGET_DATABASE_NOT_EMPTY'})
    expect(await allocations()).toHaveLength(1)
    expect((await fixture.targets[0]!.query('SELECT * FROM existing_business')).rows).toEqual([{id:7}])
    expect(await service().runRuntimeDatabaseBinding(owner,draft())).toMatchObject({status:'action_required',errorCode:'TARGET_DATABASE_NOT_EMPTY'})
    expect(await allocations()).toHaveLength(1);expect(await tables(1)).toEqual([])
  })
  it('signed HTTP rejects scope/URL injection and prepares the exact target using only the existing empty command',async()=>{
    config.publicOrigin='https://capacity.fixture.invalid';config.csrfSecret='synthetic-capacity-csrf-secret-1234567890'
    const {handleApi,sendApiError}=await import('../router.js')
    const server=http.createServer((req,res)=>{void handleApi(req,res,new URL(req.url!,'http://fixture.invalid')).catch(error=>sendApiError(res,error,req))})
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
    const origin=`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
    try{
      const login=await fetch(origin+'/api/admin/auth/login',{method:'POST',headers:{origin:config.publicOrigin,'content-type':'application/json'},
        body:JSON.stringify({email:owner.email,password:fixturePassword})})
      const csrf=(await login.json()).csrfToken,cookie=login.headers.get('set-cookie')!.split(';')[0]!
      const path='/api/admin/onboarding/drafts/'+draft()+'/provisioning/runtime-database-binding/run'
      const request=(body:unknown={},suffix='')=>fetch(origin+path+suffix,{method:'POST',headers:{origin:config.publicOrigin,cookie,
        'x-csrf-token':csrf,'content-type':'application/json'},body:JSON.stringify(body)})
      expect((await request({slotKey:'capacity-1'})).status).toBe(400)
      expect((await request({},'?databaseUrl=private')).status).toBe(400)
      expect(await allocations()).toEqual([])
      const result=await request();expect(result.status).toBe(200);expect(await result.json()).toMatchObject({status:'succeeded',scope:fixture.manifests[0]!.scope})
    }finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
  })
})
