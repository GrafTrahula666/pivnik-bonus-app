// @vitest-environment node
import http from 'node:http'
import type {Pool} from 'pg'
import {beforeAll,beforeEach,afterEach,describe,expect,it,vi} from 'vitest'
import {config} from '../config.js'
import {createOnboardingProvisioningService} from '../onboarding-provisioning.js'
import {loadEmptyTenantMigrations} from '../onboarding-tenant-bootstrap.js'
import {emptyTenantFixture} from './empty-tenant-fixture.js'
import {fixturePassword} from './onboarding-fixture.js'
import type {TenantCrmFixtureDatabase} from './tenant-crm-database-fixture.js'

const state=vi.hoisted(()=>({metadata:null as TenantCrmFixtureDatabase|null,
  targets:new Map<string,TenantCrmFixtureDatabase>(),failDdl:false,failBinding:false,failAudit:false,
  afterAccount:null as (()=>Promise<void>)|null}))
function connectable(db:TenantCrmFixtureDatabase,target=false):Pick<Pool,'connect'>{
  return {connect:async()=>{
    const client=db.connect?await db.connect():{query:db.query.bind(db),release(){}}
    return {release:()=>client.release(),async query(text:string,params?:unknown[]){
      if(target&&state.failDdl&&text.includes('CREATE TABLE IF NOT EXISTS spaceverse_customer_create_requests'))throw new Error('private-db-credential')
      if(target&&state.failBinding&&text.startsWith('INSERT INTO public.spaceverse_runtime_binding'))throw new Error('private-db-credential')
      if(!target&&state.failAudit&&text.startsWith('INSERT INTO admin_audit_log'))throw new Error('private-db-credential')
      if(!target&&text.includes('SELECT id FROM admin_accounts')&&text.includes('FOR SHARE')&&state.afterAccount){
        const action=state.afterAccount;state.afterAccount=null;await action()
      }
      if(!db.connect&&!params&&/CREATE TABLE|ALTER TABLE|DO \$\$/.test(text)){
        await db.exec(text);return {rows:[],rowCount:0}
      }
      const result=await client.query(text,params);return {...result,rowCount:result.affectedRows??result.rows.length}
    }}
  }} as unknown as Pick<Pool,'connect'>
}
vi.mock('../db.js',()=>{
  const pool={query:(text:string,params?:unknown[])=>state.metadata!.query(text,params),
    connect:async()=>connectable(state.metadata!).connect()}
  return {pool,readPool:pool,writePool:null,tableExists:async()=>false,productionTableExists:async()=>false}
})
vi.mock('../onboarding-database-registry.js',()=>({onboardingTargetRegistry:{resolveTargetDatabase:async(key:string)=>{
  const target=state.targets.get(key);return target?connectable(target,true):null
}},validateOnboardingTargetRegistry:()=>{},closeOnboardingTargetRegistry:async()=>{}}))

const owner={id:'11',email:'owner@fixture.invalid',displayName:'owner',role:'VENUE_ADMIN' as const}
describe('explicit empty tenant bootstrap: existing scope and binding ledger',()=>{
  let fixture:Awaited<ReturnType<typeof emptyTenantFixture>>
  beforeAll(()=>{expect(config.enableOnboardingDatabaseBootstrap).toBe(false)})
  beforeEach(async()=>{
    config.enableWrites=config.enableOnboardingDrafts=config.enableOnboardingInvitations=config.enableOnboardingProvisioning=true
    config.enableOnboardingDatabaseBootstrap=true
    fixture=await emptyTenantFixture();state.metadata=fixture.metadata;state.targets=new Map(fixture.registry)
  },60_000)
  afterEach(async()=>{
    state.failDdl=state.failBinding=state.failAudit=false;state.afterAccount=null
    for(const db of fixture?.targets??[])await db.close()
    await fixture?.metadata.close()
  })
  const service=(enabled=true,afterTargetCommit?:()=>Promise<void>)=>createOnboardingProvisioningService({
    metadata:connectable(fixture.metadata),allowEmptyDatabaseBootstrap:enabled,afterTargetCommit,
    resolveTargetDatabase:async key=>{const target=state.targets.get(key);return target?connectable(target,true):null},
  })
  const draft=(i=0)=>fixture.manifests[i]!.source.draftId
  const relations=async(i=0)=>(await fixture.targets[i]!.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`)).rows

  it('default-off preserves the old manual-schema requirement and never writes an empty target',async()=>{
    expect(await service(false).runRuntimeDatabaseBinding(owner,draft())).toMatchObject({status:'action_required',errorCode:'TARGET_BINDING_SCHEMA_REQUIRED'})
    expect(await relations()).toEqual([])
  })
  it('creates the canonical schema and exact binding atomically, with no customer or financial data',async()=>{
    const provisioner=service()
    const first=await provisioner.runRuntimeDatabaseBinding(owner,draft())
    expect(first).toMatchObject({status:'succeeded',result:{binding:'created'},scope:fixture.manifests[0]!.scope})
    expect(await provisioner.runRuntimeDatabaseBinding(owner,draft())).toEqual(first)
    expect(await provisioner.runTenantSchemaReadiness(owner,draft())).toMatchObject({status:'succeeded',result:{schema:'verified',ownershipBoundary:'verified'}})
    for(const table of ['users','user_identities','wallets','transactions','spaceverse_customer_ownership','spaceverse_customer_create_requests'])
      expect((await fixture.targets[0]!.query(`SELECT COUNT(*)::text AS count FROM ${table}`)).rows).toEqual([{count:'0'}])
    expect((await fixture.metadata.query('SELECT active FROM venues WHERE id=$1',[fixture.manifests[0]!.scope.venueId])).rows).toEqual([{active:false}])
  })
  it('keeps two venues of one company and a second company in separate databases for the same owner',async()=>{
    const provisioner=service()
    for(let i=0;i<3;i++){
      expect(await provisioner.runRuntimeDatabaseBinding(owner,draft(i))).toMatchObject({status:'succeeded'})
      expect((await fixture.targets[i]!.query('SELECT runtime_key,company_id,venue_id FROM spaceverse_runtime_binding')).rows)
        .toEqual([{runtime_key:fixture.manifests[i]!.runtimeKey,company_id:fixture.manifests[i]!.scope.companyId,venue_id:fixture.manifests[i]!.scope.venueId}])
    }
  })
  it.each([
    'CREATE TABLE users(id BIGINT PRIMARY KEY)',
    'CREATE SCHEMA existing_business',
    "CREATE TYPE existing_type AS ENUM ('existing')",
    'CREATE SEQUENCE existing_sequence',
    'CREATE COLLATION public.existing_collation FROM pg_catalog."C"',
    'CREATE PUBLICATION existing_publication',
    'ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO PUBLIC',
    'CREATE TEMP TABLE temporary_customers(id BIGINT)',
    'SELECT lo_create(12345)',
    "CREATE FUNCTION public.to_regclass(text) RETURNS regclass LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'UNTRUSTED_FUNCTION_EXECUTED'; END $$",
  ])('refuses nonempty targets without adopting or overwriting their objects: %s',async sql=>{
    await fixture.targets[0]!.exec(sql)
    const before=await relations()
    expect(await service().runRuntimeDatabaseBinding(owner,draft())).toMatchObject({status:'action_required',errorCode:'TARGET_DATABASE_NOT_EMPTY',result:null})
    expect(await relations()).toEqual(before)
    expect((await fixture.targets[0]!.query("SELECT pg_catalog.to_regclass('public.spaceverse_runtime_binding') AS binding")).rows).toEqual([{binding:null}])
  })
  it.each(['failDdl','failBinding'] as const)('rolls back every new object when %s fails, then retries the same operation',async fault=>{
    state[fault]=true
    expect(await service().runRuntimeDatabaseBinding(owner,draft())).toMatchObject({status:'retryable_error',errorCode:'TARGET_DATABASE_UNAVAILABLE'})
    expect(await relations()).toEqual([])
    state[fault]=false
    expect(await service().runRuntimeDatabaseBinding(owner,draft())).toMatchObject({status:'succeeded',attemptCount:2})
  })
  it('reconciles a committed target after a lost response without rerunning DDL or creating another scope',async()=>{
    expect(await service(true,async()=>{throw new Error('private-db-credential')}).runRuntimeDatabaseBinding(owner,draft()))
      .toMatchObject({status:'retryable_error',errorCode:'TARGET_CONFIRMATION_UNCERTAIN'})
    const before=await relations()
    expect(await service().runRuntimeDatabaseBinding(owner,draft())).toMatchObject({status:'succeeded',attemptCount:2,result:{binding:'verified_existing'}})
    expect(await relations()).toEqual(before)
    expect((await fixture.metadata.query('SELECT COUNT(*)::text AS count FROM admin_onboarding_provisioning_steps')).rows).toEqual([{count:'1'}])
  })
  it('rejects an aliased database belonging to another venue without rewriting its binding',async()=>{
    const provisioner=service();await provisioner.runRuntimeDatabaseBinding(owner,draft())
    state.targets.set(fixture.manifests[1]!.runtimeKey,fixture.targets[0]!)
    expect(await provisioner.runRuntimeDatabaseBinding(owner,draft(1))).toMatchObject({status:'action_required',errorCode:'TARGET_BINDING_CONFLICT'})
    expect((await fixture.targets[0]!.query('SELECT runtime_key FROM spaceverse_runtime_binding')).rows).toEqual([{runtime_key:fixture.manifests[0]!.runtimeKey}])
    expect(await relations(1)).toEqual([])
  })
  it('rechecks the current account role before claiming target DDL',async()=>{
    state.afterAccount=async()=>{await fixture.metadata.query("UPDATE admin_accounts SET role='SUPER_ADMIN' WHERE id=11")}
    await expect(service().runRuntimeDatabaseBinding(owner,draft())).rejects.toMatchObject({statusCode:403})
    expect(await relations()).toEqual([])
  })
  it('fails metadata confirmation on audit failure and safely reconciles after the lease expires',async()=>{
    state.failAudit=true
    await expect(service().runRuntimeDatabaseBinding(owner,draft())).rejects.toMatchObject({statusCode:503})
    expect(await relations()).not.toEqual([])
    expect((await fixture.metadata.query('SELECT status,result FROM admin_onboarding_provisioning_steps')).rows).toEqual([{status:'running',result:null}])
    state.failAudit=false
    await fixture.metadata.exec("UPDATE admin_onboarding_provisioning_steps SET lease_expires_at=clock_timestamp()-INTERVAL '1 second'")
    expect(await service().runRuntimeDatabaseBinding(owner,draft())).toMatchObject({status:'succeeded',attemptCount:2,result:{binding:'verified_existing'}})
  })
  it('starts initial and retry binding leases after metadata lock waits',async()=>{
    const leaseSeconds:number[]=[]
    const delayAccountLock=()=>new Promise<void>(resolve=>setTimeout(resolve,250))
    const provisioner=createOnboardingProvisioningService({
      metadata:connectable(fixture.metadata),allowEmptyDatabaseBootstrap:true,
      resolveTargetDatabase:async key=>{
        const clockBase=leaseSeconds.length===0?'created_at':'updated_at'
        const row=await fixture.metadata.query(`SELECT EXTRACT(EPOCH FROM (lease_expires_at-${clockBase})) AS seconds
          FROM admin_onboarding_provisioning_steps WHERE draft_id=$1 AND step='runtime_database_binding'`,[draft()])
        leaseSeconds.push(Number(row.rows[0]?.seconds))
        const target=state.targets.get(key)
        return target?connectable(target,true):null
      },
    })
    state.targets.clear()
    state.afterAccount=delayAccountLock
    expect(await provisioner.runRuntimeDatabaseBinding(owner,draft()))
      .toMatchObject({status:'action_required',errorCode:'TARGET_DATABASE_NOT_REGISTERED'})
    state.targets=new Map(fixture.registry)
    state.afterAccount=delayAccountLock
    expect(await provisioner.runRuntimeDatabaseBinding(owner,draft())).toMatchObject({status:'succeeded',attemptCount:2})
    expect(leaseSeconds).toHaveLength(2)
    // NOW() is fixed at BEGIN; the lease must start after the simulated lock wait.
    for(const seconds of leaseSeconds)expect(seconds).toBeGreaterThan(30.1)
  })
  it('does not confirm an expired claim after the target committed',async()=>{
    const result=await service(true,async()=>{
      await fixture.metadata.exec("UPDATE admin_onboarding_provisioning_steps SET lease_expires_at=clock_timestamp()-INTERVAL '1 second'")
    }).runRuntimeDatabaseBinding(owner,draft())
    expect(result).toMatchObject({status:'running',result:null,startAllowed:true})
  })
  it('refuses success if the account is revoked after target commit and reconciles only after access is restored',async()=>{
    await expect(service(true,async()=>{
      await fixture.metadata.exec('UPDATE admin_accounts SET active=FALSE WHERE id=11')
    }).runRuntimeDatabaseBinding(owner,draft())).rejects.toMatchObject({statusCode:403})
    expect((await fixture.metadata.query('SELECT status,result FROM admin_onboarding_provisioning_steps')).rows).toEqual([{status:'running',result:null}])
    await fixture.metadata.exec(`UPDATE admin_accounts SET active=TRUE WHERE id=11;
      UPDATE admin_onboarding_provisioning_steps SET lease_expires_at=clock_timestamp()-INTERVAL '1 second'`)
    expect(await service().runRuntimeDatabaseBinding(owner,draft())).toMatchObject({status:'succeeded',attemptCount:2,result:{binding:'verified_existing'}})
  })
  it('revoked company ownership after target commit cannot confirm a cross-company CRM binding',async()=>{
    // Owner 11 has separate grants for companies 10 and 20. Revoke only 20
    // after its target transaction commits, before metadata confirmation.
    await expect(service(true,async()=>{
      await fixture.metadata.query('DELETE FROM admin_company_access WHERE admin_id=$1 AND company_id=$2',[11,20])
    }).runRuntimeDatabaseBinding(owner,draft(2))).rejects.toMatchObject({statusCode:404})
    expect((await fixture.metadata.query(`SELECT status,result FROM admin_onboarding_provisioning_steps
      WHERE draft_id=$1 AND step='runtime_database_binding'`,[draft(2)])).rows)
      .toEqual([{status:'running',result:null}])
    expect(await relations(0)).toEqual([])
    expect(await relations(1)).toEqual([])
    // A restored, independently verified grant can reconcile the committed
    // target without executing a second bootstrap or granting access to A.
    await fixture.metadata.query(`INSERT INTO admin_company_access(admin_id,company_id,access_kind)
      VALUES(11,20,'owner')`)
    await fixture.metadata.query(`UPDATE admin_onboarding_provisioning_steps
      SET lease_expires_at=clock_timestamp()-INTERVAL '1 second'
      WHERE draft_id=$1 AND step='runtime_database_binding'`,[draft(2)])
    expect(await service().runRuntimeDatabaseBinding(owner,draft(2)))
      .toMatchObject({status:'succeeded',attemptCount:2,result:{binding:'verified_existing'}})
    expect((await fixture.targets[2]!.query('SELECT company_id,venue_id FROM spaceverse_runtime_binding')).rows)
      .toEqual([{company_id:fixture.manifests[2]!.scope.companyId,venue_id:fixture.manifests[2]!.scope.venueId}])
  })
  it('rejects premature venue activation after target commit and reconciles only after scope restoration',async()=>{
    const venueId=fixture.manifests[0]!.scope.venueId
    const companyId=fixture.manifests[0]!.scope.companyId
    // A venue activated outside the CRM/license workflow must not cause a
    // committed but still unconfirmed dedicated DB binding to report success.
    await expect(service(true,async()=>{
      await fixture.metadata.query('UPDATE venues SET active=TRUE WHERE id=$1',[venueId])
    }).runRuntimeDatabaseBinding(owner,draft())).rejects.toMatchObject({statusCode:409})
    expect((await fixture.metadata.query(`SELECT status,result FROM admin_onboarding_provisioning_steps
      WHERE draft_id=$1 AND step='runtime_database_binding'`,[draft()])).rows)
      .toEqual([{status:'running',result:null}])
    expect((await fixture.targets[0]!.query('SELECT company_id,venue_id FROM spaceverse_runtime_binding')).rows)
      .toEqual([{company_id:companyId,venue_id:venueId}])
    expect(await relations(1)).toEqual([])
    expect(await relations(2)).toEqual([])
    await fixture.metadata.query('UPDATE venues SET active=FALSE WHERE id=$1',[venueId])
    await fixture.metadata.query(`UPDATE admin_onboarding_provisioning_steps
      SET lease_expires_at=clock_timestamp()-INTERVAL '1 second'
      WHERE draft_id=$1 AND step='runtime_database_binding'`,[draft()])
    expect(await service().runRuntimeDatabaseBinding(owner,draft()))
      .toMatchObject({status:'succeeded',attemptCount:2,result:{binding:'verified_existing'}})
  })
  it('requires a server-registered target and never substitutes the metadata database',async()=>{
    state.targets.clear()
    expect(await service().runRuntimeDatabaseBinding(owner,draft())).toMatchObject({status:'action_required',errorCode:'TARGET_DATABASE_NOT_REGISTERED'})
    expect(await relations()).toEqual([])
  })
  it('allows only one live claim while another request is resolving the target',async()=>{
    let release!:()=>void,arrived!:()=>void
    const waiting=new Promise<void>(resolve=>{release=resolve}),entered=new Promise<void>(resolve=>{arrived=resolve})
    let resolutions=0
    const provisioner=createOnboardingProvisioningService({metadata:connectable(fixture.metadata),allowEmptyDatabaseBootstrap:true,
      resolveTargetDatabase:async()=>{resolutions++;arrived();await waiting;return connectable(fixture.targets[0]!,true)}})
    const first=provisioner.runRuntimeDatabaseBinding(owner,draft());await entered
    try{
      expect(await provisioner.runRuntimeDatabaseBinding(owner,draft())).toMatchObject({status:'running',attemptCount:1,startAllowed:false})
      expect(resolutions).toBe(1)
    }finally{release()}
    expect(await first).toMatchObject({status:'succeeded',attemptCount:1})
    expect((await fixture.metadata.query(`SELECT COUNT(*)::text AS count FROM admin_audit_log
      WHERE action='onboarding.provisioning_step_succeed'`)).rows).toEqual([{count:'1'}])
  })
  it('cannot publish success when its lease expires while finish waits for an account lock',async()=>{
    // Native PostgreSQL is needed for a real cross-connection lock wait. The
    // PGlite run still exercises expiry between target commit and confirmation.
    let unlock:Promise<void>|undefined
    const provisioner=service(true,async()=>{
      if(!fixture.metadata.connect){
        await fixture.metadata.exec("UPDATE admin_onboarding_provisioning_steps SET lease_expires_at=clock_timestamp()-INTERVAL '1 second'")
        return
      }
      const locker=await fixture.metadata.connect()
      await locker.query('BEGIN')
      await locker.query('UPDATE admin_accounts SET active=active WHERE id=11')
      await locker.query("UPDATE admin_onboarding_provisioning_steps SET lease_expires_at=clock_timestamp()+INTERVAL '150 milliseconds'")
      unlock=new Promise<void>((resolve,reject)=>{
        setTimeout(()=>{void locker.query('COMMIT').then(()=>resolve(),reject).finally(()=>locker.release())},300)
      })
    })
    const result=await provisioner.runRuntimeDatabaseBinding(owner,draft());await unlock
    expect(result).toMatchObject({status:'running',result:null,startAllowed:true})
    expect((await fixture.metadata.query('SELECT status,result FROM admin_onboarding_provisioning_steps')).rows).toEqual([{status:'running',result:null}])
  })
  it('keeps the core migration explicit and all shared migration envelopes inside the target transaction',async()=>{
    const sql=await loadEmptyTenantMigrations()
    expect(sql).toHaveLength(6)
    await expect(fixture.targets[0]!.exec(sql[0]!)).rejects.toThrow('Explicit empty database bootstrap required')
    expect(await relations()).toEqual([])
  })
  it('signed HTTP rejects foreign scope, viewer, URL/body injection, CSRF and disabled writes',async()=>{
    config.publicOrigin='https://empty-database.fixture.invalid';config.csrfSecret='synthetic-bootstrap-secret-1234567890'
    const {handleApi,sendApiError}=await import('../router.js')
    const server=http.createServer((req,res)=>{void handleApi(req,res,new URL(req.url!,'http://fixture.invalid')).catch(error=>sendApiError(res,error,req))})
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
    const origin=`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
    try{
      const response=await fetch(origin+'/api/admin/auth/login',{method:'POST',headers:{origin:config.publicOrigin,'content-type':'application/json'},
        body:JSON.stringify({email:'trusted@fixture.invalid',password:fixturePassword})})
      expect(response.status).toBe(200)
      const csrf=(await response.json()).csrfToken,cookie=response.headers.get('set-cookie')!.split(';')[0]!
      const path='/api/admin/onboarding/drafts/'+draft()+'/provisioning/runtime-database-binding/run'
      const request=(suffix='',body:unknown={},token=csrf)=>fetch(origin+path+suffix,{method:'POST',headers:{origin:config.publicOrigin,
        cookie,'x-csrf-token':token,'content-type':'application/json'},body:JSON.stringify(body)})
      expect((await request('?companyId=20')).status).toBe(400)
      expect((await request('',{databaseUrl:'postgres://fixture.invalid/db'})).status).toBe(400)
      expect((await request('',{},'invalid')).status).toBe(403)
      await fixture.metadata.query("UPDATE admin_onboarding_access SET role='viewer' WHERE invitation_id=$1",[fixture.viewerInvite])
      expect((await request()).status).toBe(403)
      expect(await relations()).toEqual([])
      await fixture.metadata.query("UPDATE admin_onboarding_access SET role='manager' WHERE invitation_id=$1",[fixture.viewerInvite])
      expect((await fetch(origin+path.replace(draft(),draft(1)),{method:'POST',headers:{origin:config.publicOrigin,cookie,
        'x-csrf-token':csrf,'content-type':'application/json'},body:'{}'})).status).toBe(404)
      config.enableWrites=false;expect((await request()).status).toBe(403);config.enableWrites=true
      const saved=await request();expect(saved.status).toBe(200);expect(await saved.json()).toMatchObject({status:'succeeded',scope:fixture.manifests[0]!.scope})
    }finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
  })
})
