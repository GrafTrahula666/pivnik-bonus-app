// @vitest-environment node
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import type { Pool } from 'pg'
import { PGlite } from '@electric-sql/pglite'
import { afterEach,beforeAll,describe,expect,it } from 'vitest'
import { createSpaceverseRuntimeBundle } from '../../../spaceverse-runtime-manifest.js'
import type { AdminPrincipal } from '../types.js'
import { config } from '../config.js'
import { createOnboardingProvisioningService } from '../onboarding-provisioning.js'
import { onboardingFixture } from './onboarding-fixture.js'

const root:AdminPrincipal={id:'1',email:'root@fixture.invalid',displayName:'root',role:'SUPER_ADMIN'}
const otherRoot:AdminPrincipal={id:'2',email:'other-root@fixture.invalid',displayName:'other-root',role:'SUPER_ADMIN'}
const owner:AdminPrincipal={id:'11',email:'owner@fixture.invalid',displayName:'owner',role:'VENUE_ADMIN'}
const appConfig={displayName:'Provisioning fixture',theme:'premium-dark',primaryColor:'#73bcd9',secondaryColor:'#172c36',shopEnabled:true,loyaltyEnabled:true}
const opened:PGlite[]=[]

function database(db:PGlite):Pick<Pool,'connect'> {
  const query=async(text:string,params?:unknown[])=>{
    const result=await db.query(text,params)
    return {...result,rowCount:result.rows.length||result.affectedRows||0}
  }
  return {connect:async()=>({query,release(){}})} as unknown as Pick<Pool,'connect'>
}

async function metadata() {
  const db=await onboardingFixture();opened.push(db);return db
}

async function target(withBindingSchema=true) {
  const db=new PGlite();opened.push(db)
  if(withBindingSchema) {
    for(const file of ['017_spaceverse_runtime_binding.sql','018_spaceverse_runtime_scope_binding.sql']) {
      await db.exec(await fs.readFile(new URL('../../../migrations/'+file,import.meta.url),'utf8'))
    }
  }
  return db
}

async function readyTarget() {
  const db=await target()
  await db.exec(`
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
  ]) await db.exec(await fs.readFile(new URL('../../../migrations/'+file,import.meta.url),'utf8'))
  return db
}

async function preparedDraft(db:PGlite,label:string) {
  const draftId=crypto.randomUUID(),requestKey=crypto.randomUUID()
  const tenantKey='sv-'+draftId.replaceAll('-','')
  const venue=(await db.query<{id:string}>(`INSERT INTO venues(company_id,code,name,address,active)
    VALUES(10,$1,$2,'Fixture address',FALSE) RETURNING id::text`,[tenantKey,label])).rows[0]!
  const data={companyId:'10',companyName:'',venueName:label,address:'Fixture address',timeZone:'Europe/Moscow',venueType:'bar',ownerEmail:''}
  await db.query(`INSERT INTO admin_onboarding_drafts(id,admin_id,company_id,request_key,initial_hash,data)
    VALUES($1::uuid,1,10,$2::uuid,$3,$4::jsonb)`,[draftId,requestKey,'a'.repeat(64),JSON.stringify(data)])
  await db.query(`INSERT INTO admin_onboarding_app_configs(draft_id,tenant_key,config)
    VALUES($1::uuid,$2,$3::jsonb)`,[draftId,tenantKey,JSON.stringify(appConfig)])
  await db.query(`INSERT INTO admin_onboarding_scopes(
    draft_id,company_id,venue_id,company_created_by_onboarding,draft_revision,application_revision)
    VALUES($1::uuid,10,$2::bigint,FALSE,1,1)`,[draftId,venue.id])
  return {draftId,tenantKey,venueId:venue.id}
}

async function provisioningRows(db:PGlite) {
  return (await db.query(`SELECT draft_id::text,step,runtime_key,manifest_sha256,application_revision,
    company_id::text,venue_id::text,status,attempt_count,lease_token::text,lease_expires_at::text,
    last_error_code,result FROM admin_onboarding_provisioning_steps ORDER BY draft_id,step`)).rows
}

beforeAll(()=>{
  config.enableWrites=true
  config.enableOnboardingDrafts=true
})

afterEach(async()=>{
  while(opened.length) await opened.pop()!.close()
})

describe('onboarding runtime binding provisioning ledger',()=>{
  it('image policy upgrades v2 success in the same ledger and only v3 can confirm image identity without implying launch',async()=>{
    const meta=await metadata(),tenant=await readyTarget(),draft=await preparedDraft(meta,'Image approval')
    const codeRelease={sourceSha:'a'.repeat(40),fingerprint:'b'.repeat(64),coverage:'node_literal_import_closure' as const,moduleCount:45}
    const v2=createOnboardingProvisioningService({metadata:database(meta),resolveTargetDatabase:async()=>database(tenant),requireCodeRelease:true,assembleRuntimeBundle:manifest=>createSpaceverseRuntimeBundle(manifest,codeRelease)})
    await v2.runRuntimeDatabaseBinding(root,draft.draftId);await v2.runTenantSchemaReadiness(root,draft.draftId)
    expect(await v2.runRuntimeBundleVerification(root,draft.draftId)).toMatchObject({status:'succeeded',attemptCount:1})
    let imageApproved=false
    const imageRelease={imageId:'sha256:'+'1'.repeat(64),platform:'linux/amd64' as const,contract:'tenant-runtime-v1' as const}
    const service=createOnboardingProvisioningService({metadata:database(meta),resolveTargetDatabase:async()=>database(tenant),requireImageRelease:true,
      assembleRuntimeBundle:manifest=>createSpaceverseRuntimeBundle(manifest,codeRelease,imageApproved?imageRelease:null)})
    expect(await service.getRuntimeBundleVerification(root,draft.draftId)).toMatchObject({status:'action_required',attemptCount:1,errorCode:'RUNTIME_IMAGE_NOT_REGISTERED',result:null,startAllowed:true})
    expect((await provisioningRows(meta)).find(row=>row.step==='runtime_bundle_verification')?.status).toBe('succeeded')
    expect(await service.runRuntimeBundleVerification(root,draft.draftId)).toMatchObject({status:'action_required',attemptCount:2,errorCode:'RUNTIME_IMAGE_NOT_REGISTERED',result:null,startAllowed:true})
    imageApproved=true
    const completed=await service.runRuntimeBundleVerification(root,draft.draftId)
    expect(completed).toMatchObject({status:'succeeded',attemptCount:3,result:{codeRelease,imageRelease,runtimeStatus:'not_provisioned',published:false},startAllowed:false})
    expect(await service.runRuntimeBundleVerification(root,draft.draftId)).toEqual(completed)
    expect((await provisioningRows(meta)).filter(row=>row.step==='runtime_bundle_verification')).toHaveLength(1)
    expect((await tenant.query('SELECT * FROM users')).rows).toEqual([]);expect((await tenant.query('SELECT * FROM wallets')).rows).toEqual([])
  })
  it('immutable policy treats legacy descriptor success as requiring approval and safely retries the same ledger',async()=>{
    const meta=await metadata(),tenant=await readyTarget(),draft=await preparedDraft(meta,'Release approval')
    const legacy=createOnboardingProvisioningService({metadata:database(meta),resolveTargetDatabase:async()=>database(tenant)})
    await legacy.runRuntimeDatabaseBinding(root,draft.draftId);await legacy.runTenantSchemaReadiness(root,draft.draftId)
    expect(await legacy.runRuntimeBundleVerification(root,draft.draftId)).toMatchObject({status:'succeeded',attemptCount:1})
    let approved=false
    const codeRelease={sourceSha:'a'.repeat(40),fingerprint:'b'.repeat(64),coverage:'node_literal_import_closure' as const,moduleCount:45}
    const service=createOnboardingProvisioningService({metadata:database(meta),resolveTargetDatabase:async()=>database(tenant),requireCodeRelease:true,
      assembleRuntimeBundle:manifest=>{if(!approved)throw Object.assign(new Error('Synthetic unregistered release'),{code:'RUNTIME_RELEASE_NOT_REGISTERED'});return createSpaceverseRuntimeBundle(manifest,codeRelease)}})
    expect(await service.getRuntimeBundleVerification(root,draft.draftId)).toMatchObject({status:'action_required',attemptCount:1,errorCode:'RUNTIME_RELEASE_NOT_REGISTERED',result:null,startAllowed:true})
    expect((await provisioningRows(meta)).find(row=>row.step==='runtime_bundle_verification')?.status).toBe('succeeded')
    expect(await service.runRuntimeBundleVerification(root,draft.draftId)).toMatchObject({status:'action_required',attemptCount:2,errorCode:'RUNTIME_RELEASE_NOT_REGISTERED',startAllowed:true})
    approved=true
    expect(await service.runRuntimeBundleVerification(root,draft.draftId)).toMatchObject({status:'succeeded',attemptCount:3,result:{codeRelease,runtimeStatus:'not_provisioned',published:false},startAllowed:false})
    expect(await service.runRuntimeBundleVerification(root,draft.draftId)).toMatchObject({status:'succeeded',attemptCount:3})
    expect((await tenant.query('SELECT * FROM users')).rows).toEqual([])
    expect((await tenant.query('SELECT * FROM wallets')).rows).toEqual([])
  })
  it('immutable policy refuses a valid description-only candidate without rewriting binding or manufacturing launch readiness',async()=>{
    const meta=await metadata(),tenant=await readyTarget(),draft=await preparedDraft(meta,'Description only')
    const service=createOnboardingProvisioningService({metadata:database(meta),resolveTargetDatabase:async()=>database(tenant),requireCodeRelease:true})
    await service.runRuntimeDatabaseBinding(root,draft.draftId);await service.runTenantSchemaReadiness(root,draft.draftId)
    expect(await service.runRuntimeBundleVerification(root,draft.draftId)).toMatchObject({status:'action_required',errorCode:'RUNTIME_RELEASE_NOT_REGISTERED',result:null})
    expect((await tenant.query('SELECT runtime_key FROM spaceverse_runtime_binding')).rows).toEqual([{runtime_key:draft.tenantKey}])
  })
  it('keeps migration 010 additive, repeatable and empty',async()=>{
    const db=await metadata()
    const sql=await fs.readFile(new URL('../../admin-migrations/010_onboarding_provisioning.sql',import.meta.url),'utf8')
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS admin_onboarding_provisioning_steps/i)
    expect(sql).not.toMatch(/(?:^|\n)\s*(?:INSERT|UPDATE|DELETE\s+FROM|MERGE|TRUNCATE)\b/i)
    expect(sql).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN|SCHEMA|DATABASE)\b/i)
    expect(await provisioningRows(db)).toEqual([])
    await db.exec(sql)
    expect(await provisioningRows(db)).toEqual([])
  })

  it('expands the existing ledger with an additive, repeatable migration',async()=>{
    const db=await metadata()
    const sql=await fs.readFile(new URL('../../admin-migrations/013_onboarding_schema_readiness.sql',import.meta.url),'utf8')
    expect(sql).toMatch(/tenant_schema_readiness/)
    expect(sql).not.toMatch(/(?:^|\n)\s*(?:INSERT|UPDATE|DELETE\s+FROM|MERGE|TRUNCATE)\b/i)
    expect(sql).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN|SCHEMA|DATABASE)\b/i)
    expect(await provisioningRows(db)).toEqual([])
    await db.exec(sql);await db.exec(sql)
    expect(await provisioningRows(db)).toEqual([])
  })

  it('adds runtime bundle verification to the same empty ledger without creating resources',async()=>{
    const db=await metadata()
    const sql=await fs.readFile(new URL('../../admin-migrations/014_onboarding_runtime_bundle.sql',import.meta.url),'utf8')
    expect(sql).toMatch(/runtime_bundle_verification/)
    expect(sql).not.toMatch(/(?:^|\n)\s*(?:INSERT|UPDATE|DELETE\s+FROM|MERGE|TRUNCATE)\b/i)
    expect(sql).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN|SCHEMA|DATABASE)\b/i)
    expect(await provisioningRows(db)).toEqual([])
    await db.exec(sql);await db.exec(sql)
    expect(await provisioningRows(db)).toEqual([])
  })

  it('requires a successful exact binding before schema readiness can be claimed',async()=>{
    const meta=await metadata(),draft=await preparedDraft(meta,'Readiness dependency')
    let resolutions=0
    const service=createOnboardingProvisioningService({metadata:database(meta),resolveTargetDatabase:async()=>{resolutions++;return null}})
    await expect(service.getTenantSchemaReadiness(root,draft.draftId)).rejects.toMatchObject({
      statusCode:409,code:'ONBOARDING_PROVISIONING_DEPENDENCY_REQUIRED',
    })
    await expect(service.runTenantSchemaReadiness(root,draft.draftId)).rejects.toMatchObject({
      statusCode:409,code:'ONBOARDING_PROVISIONING_DEPENDENCY_REQUIRED',
    })
    await expect(service.getRuntimeBundleVerification(root,draft.draftId)).rejects.toMatchObject({
      statusCode:409,code:'ONBOARDING_PROVISIONING_DEPENDENCY_REQUIRED',
    })
    await expect(service.runRuntimeBundleVerification(root,draft.draftId)).rejects.toMatchObject({
      statusCode:409,code:'ONBOARDING_PROVISIONING_DEPENDENCY_REQUIRED',
    })
    expect(resolutions).toBe(0)
    expect(await provisioningRows(meta)).toEqual([])
  })

  it('verifies the frozen binding, required schema and empty ownership boundary once',async()=>{
    const meta=await metadata(),tenant=await readyTarget(),draft=await preparedDraft(meta,'Readiness success')
    let resolutions=0
    const service=createOnboardingProvisioningService({metadata:database(meta),resolveTargetDatabase:async key=>{
      resolutions++;expect(key).toBe(draft.tenantKey);return database(tenant)
    }})
    expect(await service.runRuntimeDatabaseBinding(root,draft.draftId)).toMatchObject({status:'succeeded'})
    await expect(service.getRuntimeBundleVerification(root,draft.draftId)).rejects.toMatchObject({
      statusCode:409,code:'ONBOARDING_PROVISIONING_DEPENDENCY_REQUIRED',
    })
    expect(await service.getTenantSchemaReadiness(root,draft.draftId)).toMatchObject({
      step:'tenant_schema_readiness',status:'not_started',attemptCount:0,result:null,startAllowed:true,
    })
    const completed=await service.runTenantSchemaReadiness(root,draft.draftId)
    expect(completed).toMatchObject({
      step:'tenant_schema_readiness',status:'succeeded',attemptCount:1,errorCode:null,startAllowed:false,
      result:{schema:'verified',migrationSet:'009,017-020',ownershipBoundary:'verified'},
    })
    expect(await service.getTenantSchemaReadiness(root,draft.draftId)).toEqual(completed)
    expect(await service.runTenantSchemaReadiness(root,draft.draftId)).toEqual(completed)
    expect(await service.getRuntimeBundleVerification(root,draft.draftId)).toMatchObject({
      step:'runtime_bundle_verification',status:'not_started',attemptCount:0,result:null,startAllowed:true,
    })
    const bundle=await service.runRuntimeBundleVerification(root,draft.draftId)
    expect(bundle).toMatchObject({
      step:'runtime_bundle_verification',status:'succeeded',attemptCount:1,errorCode:null,startAllowed:false,
      result:{bundle:'verified',artifact:'pivnik-bonus-app',artifactContract:'tenant-runtime-v1',
        bundleSha256:expect.stringMatching(/^[0-9a-f]{64}$/),manifestSchemaVersion:2,
        runtimeStatus:'not_provisioned',published:false},
    })
    expect(await service.getRuntimeBundleVerification(root,draft.draftId)).toEqual(bundle)
    expect(await service.runRuntimeBundleVerification(root,draft.draftId)).toEqual(bundle)
    expect(resolutions).toBe(2)
    expect(await provisioningRows(meta)).toHaveLength(3)
    const audits=(await meta.query(`SELECT action,metadata FROM admin_audit_log
      WHERE entity_id=$1 ORDER BY id`,[draft.draftId])).rows
    expect(audits).toEqual([
      {action:'onboarding.provisioning_step_succeed',metadata:{step:'runtime_database_binding',binding:'created'}},
      {action:'onboarding.provisioning_step_succeed',metadata:{
        step:'tenant_schema_readiness',schema:'verified',migrationSet:'009,017-020',ownershipBoundary:'verified',
      }},
      {action:'onboarding.provisioning_step_succeed',metadata:{
        step:'runtime_bundle_verification',bundle:'verified',artifact:'pivnik-bonus-app',
        artifactContract:'tenant-runtime-v1',bundleSha256:bundle.result.bundleSha256,
        manifestSchemaVersion:2,runtimeStatus:'not_provisioned',published:false,
      }},
    ])
    expect(JSON.stringify({completed,audits})).not.toMatch(/database.*url|postgres:|password|secret|first_name/i)
  })

  it('fails closed on a tampered artifact contract and safely retries the same bundle',async()=>{
    const meta=await metadata(),tenant=await readyTarget(),draft=await preparedDraft(meta,'Bundle retry')
    let tamper=true
    const service=createOnboardingProvisioningService({
      metadata:database(meta),resolveTargetDatabase:async()=>database(tenant),
      assembleRuntimeBundle:manifest=>{
        const bundle=createSpaceverseRuntimeBundle(manifest)
        return tamper?{...bundle,bundleSha256:'0'.repeat(64)}:bundle
      },
    })
    await service.runRuntimeDatabaseBinding(root,draft.draftId)
    await service.runTenantSchemaReadiness(root,draft.draftId)
    const rejected=await service.runRuntimeBundleVerification(root,draft.draftId)
    expect(rejected).toMatchObject({
      status:'action_required',attemptCount:1,errorCode:'RUNTIME_ARTIFACT_INCOMPATIBLE',result:null,startAllowed:true,
    })
    tamper=false
    const recovered=await service.runRuntimeBundleVerification(root,draft.draftId)
    expect(recovered).toMatchObject({
      status:'succeeded',attemptCount:2,errorCode:null,result:{bundle:'verified',runtimeStatus:'not_provisioned',published:false},
    })
    expect(JSON.stringify({rejected,recovered,rows:await provisioningRows(meta)}))
      .not.toMatch(/postgres:|password|secret|databaseUrl|SPACEVERSE_RUNTIME_MANIFEST_JSON/i)
  })

  it('lets one active lease assemble the bundle when the operator double clicks',async()=>{
    const meta=await metadata(),tenant=await readyTarget(),draft=await preparedDraft(meta,'Bundle double click')
    let releaseResolver!:()=>void
    const gate=new Promise<void>(resolve=>{releaseResolver=resolve})
    let assemblies=0
    const service=createOnboardingProvisioningService({
      metadata:database(meta),resolveTargetDatabase:async()=>database(tenant),
      assembleRuntimeBundle:async manifest=>{assemblies++;await gate;return createSpaceverseRuntimeBundle(manifest)},
    })
    await service.runRuntimeDatabaseBinding(root,draft.draftId)
    await service.runTenantSchemaReadiness(root,draft.draftId)
    const first=service.runRuntimeBundleVerification(root,draft.draftId)
    for(let attempt=0;attempt<50;attempt++) {
      const rows=await provisioningRows(meta)
      if(rows.some(row=>row.step==='runtime_bundle_verification'&&row.status==='running'))break
      await new Promise(resolve=>setTimeout(resolve,2))
    }
    const second=await service.runRuntimeBundleVerification(root,draft.draftId)
    expect(second).toMatchObject({status:'running',attemptCount:1,result:null,startAllowed:false})
    expect(assemblies).toBe(1)
    releaseResolver()
    expect(await first).toMatchObject({status:'succeeded',attemptCount:1,result:{bundle:'verified'}})
    expect(assemblies).toBe(1)
  })

  it('reports fixed actions for an incomplete schema and unowned historical data',async()=>{
    const meta=await metadata(),incomplete=await target(),historical=await readyTarget()
    const incompleteDraft=await preparedDraft(meta,'Readiness schema missing')
    const historicalDraft=await preparedDraft(meta,'Readiness ownership missing')
    const targets=new Map([[incompleteDraft.tenantKey,database(incomplete)],[historicalDraft.tenantKey,database(historical)]])
    const service=createOnboardingProvisioningService({metadata:database(meta),resolveTargetDatabase:async key=>targets.get(key)??null})
    await service.runRuntimeDatabaseBinding(root,incompleteDraft.draftId)
    expect(await service.runTenantSchemaReadiness(root,incompleteDraft.draftId)).toMatchObject({
      status:'action_required',attemptCount:1,errorCode:'TARGET_TENANT_SCHEMA_REQUIRED',result:null,startAllowed:true,
    })

    const binding=await service.runRuntimeDatabaseBinding(root,historicalDraft.draftId)
    const user=(await historical.query<{id:string}>(`INSERT INTO users(first_name) VALUES('Sensitive fixture') RETURNING id::text`)).rows[0]!
    expect(await service.runTenantSchemaReadiness(root,historicalDraft.draftId)).toMatchObject({
      status:'action_required',attemptCount:1,errorCode:'TARGET_TENANT_DATA_OWNERSHIP_REQUIRED',result:null,startAllowed:true,
    })
    await historical.query(`INSERT INTO spaceverse_customer_ownership(user_id,runtime_key,company_id,venue_id)
      VALUES($1::bigint,$2,$3,$4)`,[user.id,historicalDraft.tenantKey,binding.scope.companyId,binding.scope.venueId])
    expect(await service.runTenantSchemaReadiness(root,historicalDraft.draftId)).toMatchObject({
      status:'succeeded',attemptCount:2,errorCode:null,
      result:{schema:'verified',migrationSet:'009,017-020',ownershipBoundary:'verified'},
    })
    const serialized=JSON.stringify(await provisioningRows(meta))
    expect(serialized).not.toContain('Sensitive fixture')
    expect(serialized).not.toMatch(/postgres:|password|secret|host|url/i)
  })

  it('claims, writes the exact frozen manifest binding once, reopens and replays without target work',async()=>{
    const meta=await metadata(),tenant=await target(),draft=await preparedDraft(meta,'Binding success')
    let resolutions=0
    const service=createOnboardingProvisioningService({
      metadata:database(meta),
      resolveTargetDatabase:async runtimeKey=>{
        resolutions++
        expect(runtimeKey).toBe(draft.tenantKey)
        return database(tenant)
      },
    })
    expect(await service.getRuntimeDatabaseBinding(root,draft.draftId)).toMatchObject({
      draftId:draft.draftId,runtimeKey:draft.tenantKey,status:'not_started',attemptCount:0,
      scope:{companyId:'10',venueId:draft.venueId},result:null,errorCode:null,startAllowed:true,
    })
    const completed=await service.runRuntimeDatabaseBinding(root,draft.draftId)
    expect(completed).toMatchObject({status:'succeeded',attemptCount:1,errorCode:null,result:{binding:'created'},startAllowed:false})
    const binding=(await tenant.query(`SELECT runtime_key,manifest_sha256,manifest_revision,company_id,venue_id,isolation_policy,status
      FROM spaceverse_runtime_binding`)).rows
    expect(binding).toEqual([{
      runtime_key:draft.tenantKey,manifest_sha256:completed.manifestSha256,manifest_revision:1,
      company_id:'10',venue_id:draft.venueId,isolation_policy:'dedicated_database',status:'prepared',
    }])
    expect(await service.getRuntimeDatabaseBinding(root,draft.draftId)).toEqual(completed)
    expect(await service.runRuntimeDatabaseBinding(root,draft.draftId)).toEqual(completed)
    expect(resolutions).toBe(1)
    expect(await provisioningRows(meta)).toHaveLength(1)
    const audits=(await meta.query(`SELECT action,metadata FROM admin_audit_log
      WHERE entity_id=$1 ORDER BY id`,[draft.draftId])).rows
    expect(audits).toEqual([{action:'onboarding.provisioning_step_succeed',metadata:{step:'runtime_database_binding',binding:'created'}}])
    expect(JSON.stringify(audits)).not.toMatch(/database.*url|postgres:|password|secret/i)
  })

  it('lets only one unexpired lease execute a double click',async()=>{
    const meta=await metadata(),tenant=await target(),draft=await preparedDraft(meta,'Lease double click')
    let releaseResolver!:()=>void
    const gate=new Promise<void>(resolve=>{releaseResolver=resolve})
    let resolutions=0
    const service=createOnboardingProvisioningService({metadata:database(meta),resolveTargetDatabase:async()=>{
      resolutions++
      await gate
      return database(tenant)
    }})
    const first=service.runRuntimeDatabaseBinding(root,draft.draftId)
    for(let attempt=0;attempt<50;attempt++) {
      const rows=await provisioningRows(meta)
      if(rows[0]?.status==='running') break
      await new Promise(resolve=>setTimeout(resolve,2))
    }
    const second=await service.runRuntimeDatabaseBinding(root,draft.draftId)
    expect(second).toMatchObject({status:'running',attemptCount:1,result:null,startAllowed:false})
    expect(resolutions).toBe(1)
    releaseResolver()
    expect(await first).toMatchObject({status:'succeeded',attemptCount:1,result:{binding:'created'}})
    expect((await tenant.query('SELECT COUNT(*)::integer AS count FROM spaceverse_runtime_binding')).rows[0]).toEqual({count:1})
  })

  it('reconciles an uncertain response and reclaims an expired lease without duplicating a binding',async()=>{
    const meta=await metadata(),tenant=await target(),draft=await preparedDraft(meta,'Uncertain commit')
    let failAfterCommit=true
    const service=createOnboardingProvisioningService({
      metadata:database(meta),resolveTargetDatabase:async()=>database(tenant),
      afterTargetCommit:()=>{if(failAfterCommit){failAfterCommit=false;throw new Error('synthetic lost response')}},
    })
    const uncertain=await service.runRuntimeDatabaseBinding(root,draft.draftId)
    expect(uncertain).toMatchObject({status:'retryable_error',attemptCount:1,errorCode:'TARGET_CONFIRMATION_UNCERTAIN',result:null})
    expect((await tenant.query('SELECT COUNT(*)::integer AS count FROM spaceverse_runtime_binding')).rows[0]).toEqual({count:1})
    const recovered=await service.runRuntimeDatabaseBinding(root,draft.draftId)
    expect(recovered).toMatchObject({status:'succeeded',attemptCount:2,errorCode:null,result:{binding:'verified_existing'}})

    await meta.query(`UPDATE admin_onboarding_provisioning_steps SET status='running',attempt_count=2,
      lease_token=$2::uuid,lease_expires_at=NOW()-INTERVAL '1 second',last_error_code=NULL,result=NULL
      WHERE draft_id=$1::uuid`,[draft.draftId,crypto.randomUUID()])
    expect(await service.getRuntimeDatabaseBinding(root,draft.draftId)).toMatchObject({
      status:'running',attemptCount:2,startAllowed:true,
    })
    const reclaimed=await service.runRuntimeDatabaseBinding(root,draft.draftId)
    expect(reclaimed).toMatchObject({status:'succeeded',attemptCount:3,result:{binding:'verified_existing'}})
    expect((await tenant.query('SELECT COUNT(*)::integer AS count FROM spaceverse_runtime_binding')).rows[0]).toEqual({count:1})
  })

  it('never overwrites another binding and records schema/registry actions without database details',async()=>{
    const meta=await metadata(),conflicting=await target(),empty=await target(false)
    const conflictDraft=await preparedDraft(meta,'Binding conflict')
    await conflicting.query(`INSERT INTO spaceverse_runtime_binding(
      singleton,runtime_key,manifest_sha256,manifest_revision,company_id,venue_id,isolation_policy,status)
      VALUES(TRUE,$1,$2,1,'999','999','dedicated_database','prepared')`,['sv-'+'f'.repeat(32),'f'.repeat(64)])
    const targets=new Map<string,Pick<Pool,'connect'>|null>([[conflictDraft.tenantKey,database(conflicting)]])
    const service=createOnboardingProvisioningService({metadata:database(meta),resolveTargetDatabase:async key=>targets.get(key)??null})
    const conflict=await service.runRuntimeDatabaseBinding(root,conflictDraft.draftId)
    expect(conflict).toMatchObject({status:'action_required',attemptCount:1,errorCode:'TARGET_BINDING_CONFLICT',startAllowed:true})
    expect((await conflicting.query('SELECT runtime_key FROM spaceverse_runtime_binding')).rows).toEqual([{runtime_key:'sv-'+'f'.repeat(32)}])

    const schemaDraft=await preparedDraft(meta,'Schema missing')
    targets.set(schemaDraft.tenantKey,database(empty))
    expect(await service.runRuntimeDatabaseBinding(root,schemaDraft.draftId)).toMatchObject({
      status:'action_required',attemptCount:1,errorCode:'TARGET_BINDING_SCHEMA_REQUIRED',
    })
    const registryDraft=await preparedDraft(meta,'Registry missing')
    expect(await service.runRuntimeDatabaseBinding(root,registryDraft.draftId)).toMatchObject({
      status:'action_required',attemptCount:1,errorCode:'TARGET_DATABASE_NOT_REGISTERED',
    })
    const serialized=JSON.stringify(await provisioningRows(meta))
    expect(serialized).not.toMatch(/postgres:|password|secret|host|url/i)
  })

  it('derives scope from creator membership and never from caller-supplied target data',async()=>{
    const meta=await metadata(),tenantA=await readyTarget(),tenantB=await readyTarget()
    const a=await preparedDraft(meta,'Tenant A'),b=await preparedDraft(meta,'Tenant B')
    const targets=new Map([[a.tenantKey,database(tenantA)],[b.tenantKey,database(tenantB)]])
    const service=createOnboardingProvisioningService({metadata:database(meta),resolveTargetDatabase:async key=>targets.get(key)??null})
    await expect(service.runRuntimeDatabaseBinding(owner,a.draftId)).rejects.toMatchObject({statusCode:403,code:'SUPER_ADMIN_REQUIRED'})
    await expect(service.runRuntimeDatabaseBinding(otherRoot,a.draftId)).rejects.toMatchObject({statusCode:404,code:'ONBOARDING_DRAFT_NOT_FOUND'})
    expect(await provisioningRows(meta)).toEqual([])
    const resultA=await service.runRuntimeDatabaseBinding(root,a.draftId)
    const resultB=await service.runRuntimeDatabaseBinding(root,b.draftId)
    expect(resultA).toMatchObject({status:'succeeded',runtimeKey:a.tenantKey,scope:{companyId:'10',venueId:a.venueId}})
    expect(resultB).toMatchObject({status:'succeeded',runtimeKey:b.tenantKey,scope:{companyId:'10',venueId:b.venueId}})
    expect((await tenantA.query('SELECT runtime_key,company_id,venue_id FROM spaceverse_runtime_binding')).rows)
      .toEqual([{runtime_key:a.tenantKey,company_id:'10',venue_id:a.venueId}])
    expect((await tenantB.query('SELECT runtime_key,company_id,venue_id FROM spaceverse_runtime_binding')).rows)
      .toEqual([{runtime_key:b.tenantKey,company_id:'10',venue_id:b.venueId}])
    expect(await service.runTenantSchemaReadiness(root,a.draftId)).toMatchObject({
      status:'succeeded',runtimeKey:a.tenantKey,scope:{companyId:'10',venueId:a.venueId},
    })
    expect(await service.runTenantSchemaReadiness(root,b.draftId)).toMatchObject({
      status:'succeeded',runtimeKey:b.tenantKey,scope:{companyId:'10',venueId:b.venueId},
    })
    const bundleA=await service.runRuntimeBundleVerification(root,a.draftId)
    const bundleB=await service.runRuntimeBundleVerification(root,b.draftId)
    expect(bundleA).toMatchObject({status:'succeeded',runtimeKey:a.tenantKey,scope:{companyId:'10',venueId:a.venueId}})
    expect(bundleB).toMatchObject({status:'succeeded',runtimeKey:b.tenantKey,scope:{companyId:'10',venueId:b.venueId}})
    expect(bundleA.result.bundleSha256).not.toBe(bundleB.result.bundleSha256)
    expect(await provisioningRows(meta)).toHaveLength(6)
  })
})
