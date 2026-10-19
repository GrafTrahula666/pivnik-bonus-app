// @vitest-environment node
import http from 'node:http'
import crypto from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { type SpaceverseRuntimeManifest } from '../../../spaceverse-runtime-manifest.js'
import { config } from '../config.js'
import {fixturePassword} from './onboarding-fixture.js'
import {tenantCrmActivationFixture} from './tenant-crm-activation-fixture.js'
import {tenantCrmApplication} from './tenant-crm-fixture.js'
import { type TenantCrmFixtureDatabase } from './tenant-crm-database-fixture.js'

const state = vi.hoisted(() => ({ metadata: null as TenantCrmFixtureDatabase | null,
  targets: new Map<string, TenantCrmFixtureDatabase>(), queries: [] as string[], readOnly: [] as unknown[], resolutions: 0,
  afterRead: null as (() => Promise<void>) | null, hold: null as Promise<void>|null, failConnect: false, failAudit: false }))
vi.mock('../db.js', () => {
  const execute = async (db: Pick<TenantCrmFixtureDatabase, 'query'>, text: string, params?: unknown[]) => {
    if (state.failAudit && text.startsWith('INSERT INTO admin_audit_log')) throw new Error('Synthetic private audit failure')
    const result = await db.query(text, params)
    return { ...result, rowCount: result.rows.length || result.affectedRows || 0 }
  }
  const query = (text: string, params?: unknown[]) => execute(state.metadata!, text, params)
  const db = { query, connect: async () => {
    const connection = state.metadata!.connect ? await state.metadata!.connect() : { query: state.metadata!.query.bind(state.metadata!), release() {} }
    return { query: (text: string, params?: unknown[]) => execute(connection, text, params), release: () => connection.release() }
  } }
  return { pool: db, readPool: db, writePool: null, tableExists: async () => false, productionTableExists: async () => false }
})
vi.mock('../onboarding-database-registry.js', () => {
  const registry = { validate: () => ({ registered: state.targets.size }), close: async () => {},
    async resolveTargetDatabase(key: string) {
      state.resolutions++;if(state.hold)await state.hold
      const db = state.targets.get(key)
      if (!db) return null
      return { async connect() {
        if (state.failConnect) throw new Error('postgres://synthetic:secret@fixture.invalid/private')
        const connection = db.connect ? await db.connect() : { query: db.query.bind(db), release() {} }
        return { release: () => connection.release(), async query(text: string, params?: unknown[]) {
          state.queries.push(text)
          const result = await connection.query(text, params)
          if (text.includes('WITH exact_ownership AS')) {
            state.readOnly.push((await connection.query('SHOW transaction_read_only')).rows[0]?.transaction_read_only)
          }
          if (text.includes('WITH exact_ownership AS') && state.afterRead) {
            const action = state.afterRead; state.afterRead = null; await action()
          }
          return { ...result, rowCount: result.rows.length || result.affectedRows || 0 }
        } }
      } }
    } }
  return { onboardingTargetRegistry: registry, validateOnboardingTargetRegistry: registry.validate,
    closeOnboardingTargetRegistry: registry.close }
})

describe('CRM activation preflight: signed HTTP, scoped leased operation and native target SQL', () => {
  let server: http.Server | undefined, origin = '', viewerInvite = ''
  const sessions = new Map<string, string>(),csrfTokens=new Map<string,string>()
  const manifests: SpaceverseRuntimeManifest[] = [], targets: TenantCrmFixtureDatabase[] = []
  const application=tenantCrmApplication

  beforeAll(async () => {
    expect(config.enableTenantCrmActivationChecks).toBe(false)
    config.enableWrites = config.enableOnboardingDrafts = config.enableOnboardingInvitations = true
    config.enableTenantCrmActivationChecks = true
    config.publicOrigin = 'https://tenant-crm.fixture.invalid'
    config.csrfSecret = 'fixture-only-tenant-crm-secret-1234567890'
    const fixture=await tenantCrmActivationFixture()
    state.metadata=fixture.metadata;viewerInvite=fixture.viewerInvite
    manifests.push(...fixture.manifests);targets.push(...fixture.targets)
    for(const [key,db] of fixture.registry)state.targets.set(key,db)
    const { handleApi, sendApiError } = await import('../router.js')
    server = http.createServer((req, res) => { void handleApi(req, res, new URL(req.url!, origin)).catch(error => sendApiError(res, error, req)) })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
    for (const who of ['root', 'other-root', 'owner', 'trusted', 'south']) {
      const response = await fetch(origin + '/api/admin/auth/login', { method: 'POST', headers: {
        origin: config.publicOrigin, 'content-type': 'application/json' },
      body: JSON.stringify({ email: who + '@fixture.invalid', password: fixturePassword }) })
      expect(response.status).toBe(200);csrfTokens.set(who,(await response.json()).csrfToken)
      sessions.set(who, response.headers.get('set-cookie')!.split(';')[0]!)
    }
  }, 30_000)

  afterEach(async()=>{
    config.enableWrites=config.enableOnboardingDrafts=config.enableTenantCrmActivationChecks=true
    config.enableOnboardingWorkflow=config.enableOnboardingPosProxy=false
    vi.unstubAllEnvs();state.failConnect=state.failAudit=false;state.afterRead=null;state.hold=null
    state.queries=[];state.readOnly=[];state.resolutions=0
    manifests.forEach((manifest,index)=>state.targets.set(manifest.runtimeKey,targets[index]!))
    await state.metadata!.query('UPDATE admin_accounts SET active=TRUE WHERE id=11')
    await state.metadata!.query("UPDATE admin_company_access SET access_kind='owner' WHERE admin_id=11")
    await state.metadata!.query("UPDATE admin_onboarding_access SET role='manager',revoked_at=NULL WHERE invitation_id=$1",[viewerInvite])
    await state.metadata!.query('UPDATE admin_onboarding_app_configs SET config=$1 WHERE draft_id=$2',[JSON.stringify(application),manifests[0]!.source.draftId])
    await state.metadata!.query(`UPDATE admin_onboarding_provisioning_steps SET status='action_required',
      attempt_count=0,lease_token=NULL,lease_expires_at=NULL,last_error_code=NULL,result=NULL WHERE step='crm_activation_check'`)
    const {__resetRateLimitBucketsForTests}=await import('../security.js');__resetRateLimitBucketsForTests()
  })
  afterAll(async()=>{
    if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()))
    for(const db of targets)await db.close()
    await state.metadata?.close()
  })
  const path=(index=0)=>`/api/admin/onboarding/drafts/${manifests[index]!.source.draftId}/crm/activation-check`
  const request=(who:string|null='owner',method='GET',index=0,body:unknown={},extra:Record<string,string>={},suffix='')=>fetch(origin+path(index)+suffix,{
    method,headers:{origin:config.publicOrigin,'content-type':'application/json',
      ...(who?{cookie:sessions.get(who)!,'x-csrf-token':csrfTokens.get(who)!}:{}),...extra},
    ...(method==='GET'?{}:{body:JSON.stringify(body)}),
  })
  const rows=async()=> (await state.metadata!.query(`SELECT status,attempt_count,last_error_code,result,
    (lease_token IS NOT NULL) AS leased FROM admin_onboarding_provisioning_steps
    WHERE draft_id=$1 AND step='crm_activation_check'`,[manifests[0]!.source.draftId])).rows
  const auditCount=async()=>Number((await state.metadata!.query<{count:string}>(`SELECT COUNT(*)::text AS count FROM admin_audit_log
    WHERE metadata->>'step'='crm_activation_check'`)).rows[0]!.count)

  it('requires a signed session and all default-off switches before resolving any target',async()=>{
    expect((await request(null)).status).toBe(401)
    for(const flag of ['enableWrites','enableOnboardingDrafts','enableTenantCrmActivationChecks'] as const){
      config[flag]=false
      expect((await request()).status).toBe(403)
      expect((await request('owner','POST')).status).toBe(403)
      config[flag]=true
    }
    expect(state.resolutions).toBe(0)
  })
  it('shows a resumable not-started state without touching the target or claiming activation',async()=>{
    const response=await request();expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({schemaVersion:1,scope:manifests[0]!.scope,
      activationAllowed:false,crmStatus:'not_provisioned',guestApplicationRequired:false,
      operation:{step:'crm_activation_check',status:'not_started',attemptCount:0,startAllowed:true,result:null}})
    expect(state.resolutions).toBe(0)
  })
  it('rejects forged scope/license/status, query parameters, missing CSRF, wrong origin and unsupported methods',async()=>{
    for(const body of [{companyId:'20'},{venueId:'1'},{license:'paid'},{status:'active'},{databaseUrl:'postgres://secret@invalid/db'},[],null])
      expect((await request('owner','POST',0,body)).status).toBe(400)
    expect((await request('owner','POST',0,{}, {'x-csrf-token':''})).status).toBe(403)
    expect((await request('owner','POST',0,{}, {origin:'https://foreign.invalid'})).status).toBe(403)
    expect((await request('owner','PUT')).status).toBe(405)
    expect((await request('owner','GET',0,{}, {},'?companyId=20')).status).toBe(400)
    expect(state.resolutions).toBe(0)
  })
  it('rechecks real SQL for two companies and two same-company venues without requiring a guest bundle',async()=>{
    for(const [index,who] of ['owner','owner','south'].entries()){
      const response=await request(who,'POST',index);expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({scope:manifests[index]!.scope,crmStatus:'not_provisioned',activationAllowed:false,
        operation:{status:'action_required',errorCode:'CRM_PROVIDER_VERIFICATION_REQUIRED',attemptCount:1,result:null}})
    }
    expect(state.readOnly).toEqual(['on','on','on'])
    expect(state.queries.filter(query=>/^(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i.test(query))).toEqual([])
    expect((await state.metadata!.query("SELECT 1 FROM admin_onboarding_provisioning_steps WHERE step='runtime_bundle_verification'")).rows).toEqual([])
    expect((await state.metadata!.query('SELECT active FROM venues WHERE id=ANY($1::bigint[])',[manifests.map(value=>value.scope.venueId)])).rows).toEqual([{active:false},{active:false},{active:false}])
  })
  it('does not broaden company owner, scoped manager or another super-admin access',async()=>{
    expect((await request('owner','POST',2)).status).toBe(404)
    expect((await request('other-root','POST')).status).toBe(404)
    expect((await request('trusted','POST',1)).status).toBe(404)
    expect(state.resolutions).toBe(0)
    expect((await request('trusted','POST')).status).toBe(200)
    await state.metadata!.query("UPDATE admin_onboarding_access SET role='viewer' WHERE invitation_id=$1",[viewerInvite])
    expect((await request('trusted','POST')).status).toBe(403)
    await state.metadata!.query("UPDATE admin_onboarding_access SET role='manager',revoked_at=NOW() WHERE invitation_id=$1",[viewerInvite])
    expect((await request('trusted')).status).toBe(403)
  })
  it('requires exact successful schema preparation before starting the CRM operation',async()=>{
    await state.metadata!.query("UPDATE admin_onboarding_provisioning_steps SET status='action_required',result=NULL WHERE draft_id=$1 AND step='tenant_schema_readiness'",[manifests[0]!.source.draftId])
    try{expect((await request('owner','POST')).status).toBe(409);expect(state.resolutions).toBe(0)}
    finally{await state.metadata!.query("UPDATE admin_onboarding_provisioning_steps SET status='succeeded',result='{}' WHERE draft_id=$1 AND step='tenant_schema_readiness'",[manifests[0]!.source.draftId])}
  })
  it('records missing registration separately from an unavailable database and persists the result across GET',async()=>{
    state.targets.clear()
    let response=await request('owner','POST');expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({activationStatus:'pending',operation:{errorCode:'TARGET_DATABASE_NOT_REGISTERED'}})
    state.targets.set(manifests[0]!.runtimeKey,targets[0]!);state.failConnect=true
    response=await request('owner','POST');expect(response.status).toBe(200)
    const result=await response.json()
    expect(result).toMatchObject({activationStatus:'failed',operation:{status:'retryable_error',attemptCount:2,errorCode:'TARGET_DATABASE_UNAVAILABLE'}})
    expect(JSON.stringify(result)).not.toMatch(/postgres:|synthetic:secret|Owned|balance/)
    expect(await (await request()).json()).toEqual(result)
  })
  it.each([1,2])('refuses another venue/company database (target %s) even with stored successful schema proof',async index=>{
    state.targets.set(manifests[0]!.runtimeKey,targets[index]!)
    const response=await request('owner','POST');expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({activationAllowed:false,operation:{errorCode:'TARGET_BINDING_CONFLICT',status:'action_required'}})
  })
  it('does not trust saved schema success if the actual schema has changed',async()=>{
    await targets[0]!.exec('ALTER TABLE user_identities RENAME TO unavailable_user_identities')
    try{
      const response=await request('owner','POST');expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({operation:{errorCode:'TARGET_TENANT_SCHEMA_REQUIRED',status:'action_required'}})
    }finally{await targets[0]!.exec('ALTER TABLE unavailable_user_identities RENAME TO user_identities')}
  })
  it('rejects data without exact ownership instead of adopting it or enabling the venue',async()=>{
    const db=targets[0]!,manifest=manifests[0]!
    await db.exec("INSERT INTO users(id,first_name) VALUES(9911,'Synthetic unowned row')")
    try{
      const response=await request('owner','POST');expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({operation:{errorCode:'TARGET_TENANT_DATA_OWNERSHIP_REQUIRED'}})
    }finally{await db.query('INSERT INTO spaceverse_customer_ownership(user_id,runtime_key,company_id,venue_id) VALUES(9911,$1,$2,$3)',[manifest.runtimeKey,manifest.scope.companyId,manifest.scope.venueId])}
  })
  it('blocks duplicate concurrent requests with one retained attempt and no repeated target probe',async()=>{
    let release!:()=>void;state.hold=new Promise<void>(resolve=>{release=resolve})
    const first=request('owner','POST')
    try{
      await vi.waitFor(()=>expect(state.resolutions).toBe(1))
      const duplicate=await request('owner','POST');expect(duplicate.status).toBe(200)
      expect(await duplicate.json()).toMatchObject({activationStatus:'verifying',operation:{status:'running',attemptCount:1,startAllowed:false}})
    }finally{release()}
    expect((await first).status).toBe(200);expect(state.resolutions).toBe(1)
    expect(await rows()).toEqual([{status:'action_required',attempt_count:1,last_error_code:'CRM_PROVIDER_VERIFICATION_REQUIRED',result:null,leased:false}])
  })
  it('suppresses completion and audit when the owner grant is revoked during target verification',async()=>{
    const before=await auditCount()
    state.afterRead=async()=>{await state.metadata!.query("UPDATE admin_company_access SET access_kind='trusted' WHERE admin_id=11")}
    expect((await request('owner','POST')).status).toBe(403)
    expect(await rows()).toEqual([expect.objectContaining({status:'running',leased:true})])
    expect(await auditCount()).toBe(before)
  })
  it('rechecks an invited manager grant at completion, without company-wide access',async()=>{
    state.afterRead=async()=>{await state.metadata!.query('UPDATE admin_onboarding_access SET revoked_at=NOW() WHERE invitation_id=$1',[viewerInvite])}
    expect((await request('trusted','POST')).status).toBe(403)
    expect((await state.metadata!.query("SELECT access_kind FROM admin_company_access WHERE admin_id=12 AND company_id=10")).rows).toEqual([{access_kind:'trusted'}])
  })
  it('rejects a changed frozen manifest before recording completion',async()=>{
    state.afterRead=async()=>{await state.metadata!.query(`UPDATE admin_onboarding_app_configs SET config=jsonb_set(config,'{displayName}','"Changed"') WHERE draft_id=$1`,[manifests[0]!.source.draftId])}
    expect((await request('owner','POST')).status).toBe(503)
    expect(await rows()).toEqual([expect.objectContaining({status:'running',leased:true})])
  })
  it('does not let an expired worker overwrite or report a completed check; a retry reclaims the same row',async()=>{
    state.afterRead=async()=>{await state.metadata!.query("UPDATE admin_onboarding_provisioning_steps SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE draft_id=$1 AND step='crm_activation_check'",[manifests[0]!.source.draftId])}
    let response=await request('owner','POST');expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({activationStatus:'pending',operation:{status:'running',startAllowed:true,attemptCount:1}})
    response=await request('owner','POST');expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({operation:{status:'action_required',attemptCount:2}})
  })
  it('rolls back completion if auditing fails and records only bounded non-secret diagnostics on retry',async()=>{
    const before=await auditCount();state.failAudit=true
    expect((await request('owner','POST')).status).toBe(503)
    expect(await rows()).toEqual([expect.objectContaining({status:'running',leased:true})])
    expect(await auditCount()).toBe(before);state.failAudit=false
    await state.metadata!.query("UPDATE admin_onboarding_provisioning_steps SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE draft_id=$1 AND step='crm_activation_check'",[manifests[0]!.source.draftId])
    expect((await request('owner','POST')).status).toBe(200)
    const audit=(await state.metadata!.query(`SELECT company_id::text,venue_id::text,metadata FROM admin_audit_log
      WHERE metadata->>'step'='crm_activation_check' ORDER BY id DESC LIMIT 1`)).rows[0]
    expect(audit).toEqual({company_id:manifests[0]!.scope.companyId,venue_id:manifests[0]!.scope.venueId,
      metadata:{step:'crm_activation_check',errorCode:'CRM_PROVIDER_VERIFICATION_REQUIRED'}})
  })
  it('enforces the actor rate limit across GET and POST',async()=>{
    for(let count=0;count<20;count++)expect((await request()).status).toBe(200)
    expect((await request('owner','POST')).status).toBe(429);expect(state.resolutions).toBe(0)
  })
  it('refuses completion when the account is disabled during target verification',async()=>{
    state.afterRead=async()=>{await state.metadata!.query('UPDATE admin_accounts SET active=FALSE WHERE id=11')}
    expect((await request('owner','POST')).status).toBe(403)
    expect(await rows()).toEqual([expect.objectContaining({status:'running',leased:true})])
  })
  it('a worker that lost its lease cannot overwrite a newer completed attempt or duplicate its audit',async()=>{
    let release!:()=>void;state.hold=new Promise<void>(resolve=>{release=resolve})
    const first=request('owner','POST')
    try{
      await vi.waitFor(()=>expect(state.resolutions).toBe(1))
      await state.metadata!.query("UPDATE admin_onboarding_provisioning_steps SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE draft_id=$1 AND step='crm_activation_check'",[manifests[0]!.source.draftId])
      state.hold=null
      const before=await auditCount(),second=await request('owner','POST');expect(second.status).toBe(200)
      expect(await second.json()).toMatchObject({operation:{attemptCount:2,status:'action_required'}})
      expect(await auditCount()).toBe(before+1)
      release();expect((await first).status).toBe(200)
      expect(await auditCount()).toBe(before+1)
      expect(await rows()).toEqual([expect.objectContaining({attempt_count:2,status:'action_required'})])
    }finally{release();await first}
  })
  it('keeps Market unconfigured after fresh saved provider evidence; rejects stale evidence and unreadable credentials',async()=>{
    config.enableOnboardingWorkflow=config.enableOnboardingPosProxy=true
    vi.stubEnv('ADMIN_ONBOARDING_SECRET_ACTIVE_KEY_ID','crm-activation-fixture')
    vi.stubEnv('ADMIN_ONBOARDING_SECRET_KEYRING',JSON.stringify({'crm-activation-fixture':Buffer.alloc(32,7).toString('base64')}))
    const base='/api/admin/onboarding/drafts/'+manifests[0]!.source.draftId
    const put=(suffix:string,body:unknown)=>fetch(origin+base+suffix,{method:'PUT',headers:{origin:config.publicOrigin,
      cookie:sessions.get('owner')!,'x-csrf-token':csrfTokens.get('owner')!,'content-type':'application/json'},body:JSON.stringify(body)})
    expect((await put('/progress',{revision:0,progress:{currentStep:'verification',terminal:{id:'fixture-terminal',label:'Касса'},cashReports:true}})).status).toBe(200)
    expect((await put('/integrations/pos-proxy',{requestKey:crypto.randomUUID(),revision:0,storeId:'fixture-store',deviceKey:'pvpos_'+('A'.repeat(43))})).status).toBe(200)
    // Synthetic evidence at the external provider boundary, never a live probe.
    await state.metadata!.query(`UPDATE admin_onboarding_pos_proxy SET status='active',last_code='confirmed',
      checked_at=NOW(),verified_at=NOW(),last_device_event_at=NOW(),report=$2 WHERE draft_id=$1`,
      [manifests[0]!.source.draftId,JSON.stringify({state:'available',empty:true,netCents:'0',receiptCount:0,
        period:{from:new Date(Date.now()-86400000).toISOString(),until:new Date().toISOString()}})])
    let response=await request('owner','POST');expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({crmStatus:'not_provisioned',activationAllowed:false,
      operation:{status:'action_required',errorCode:'CRM_MARKET_CONTRACT_REQUIRED'}})
    await state.metadata!.query("UPDATE admin_onboarding_pos_proxy SET last_device_event_at=NOW()-INTERVAL '10 minutes' WHERE draft_id=$1",[manifests[0]!.source.draftId])
    response=await request('owner','POST');expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({operation:{errorCode:'CRM_PROVIDER_VERIFICATION_REQUIRED'}})
    vi.stubEnv('ADMIN_ONBOARDING_SECRET_KEYRING',JSON.stringify({'other-key':Buffer.alloc(32,8).toString('base64')}))
    response=await request('owner','POST');expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toMatch(/pvpos_|secret_ciphertext|fixture-store|first_name/)
  })
  it('the manual metadata constraint rejects successful activation even if application code attempts it',async()=>{
    expect((await request('owner','POST')).status).toBe(200)
    await expect(state.metadata!.query(`UPDATE admin_onboarding_provisioning_steps SET status='succeeded',result='{}',
      last_error_code=NULL WHERE draft_id=$1 AND step='crm_activation_check'`,[manifests[0]!.source.draftId])).rejects.toThrow()
    expect(await rows()).toEqual([expect.objectContaining({status:'action_required',result:null})])
  })
})
