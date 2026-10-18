// @vitest-environment node
import http from 'node:http'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { type SpaceverseRuntimeManifest } from '../../../spaceverse-runtime-manifest.js'
import { config } from '../config.js'
import {fixturePassword} from './onboarding-fixture.js'
import {tenantCrmFixture,tenantCrmApplication} from './tenant-crm-fixture.js'
import { type TenantCrmFixtureDatabase } from './tenant-crm-database-fixture.js'

const state = vi.hoisted(() => ({ metadata: null as TenantCrmFixtureDatabase | null,
  targets: new Map<string, TenantCrmFixtureDatabase>(), queries: [] as string[], readOnly: [] as unknown[], resolutions: 0,
  afterRead: null as (() => Promise<void>) | null, failConnect: false, failAudit: false }))
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
      state.resolutions++
      const db = state.targets.get(key)
      if (!db) return null
      return { async connect() {
        if (state.failConnect) throw new Error('postgres://synthetic:secret@fixture.invalid/private')
        const connection = db.connect ? await db.connect() : { query: db.query.bind(db), release() {} }
        return { release: () => connection.release(), async query(text: string, params?: unknown[]) {
          state.queries.push(text)
          const result = await connection.query(text, params)
          if (text.includes('WITH verified_binding AS')) {
            state.readOnly.push((await connection.query('SHOW transaction_read_only')).rows[0]?.transaction_read_only)
          }
          if (text.includes('WITH verified_binding AS') && state.afterRead) {
            const action = state.afterRead; state.afterRead = null; await action()
          }
          return { ...result, rowCount: result.rows.length || result.affectedRows || 0 }
        } }
      } }
    } }
  return { onboardingTargetRegistry: registry, validateOnboardingTargetRegistry: registry.validate,
    closeOnboardingTargetRegistry: registry.close }
})

describe('tenant CRM preparation read: signed HTTP, canonical metadata and isolated customer SQL', () => {
  let server: http.Server | undefined, origin = '', viewerInvite = ''
  const sessions = new Map<string, string>()
  const manifests: SpaceverseRuntimeManifest[] = [], targets: TenantCrmFixtureDatabase[] = []
  const application=tenantCrmApplication

  beforeAll(async () => {
    expect(config.enableTenantCrmReads).toBe(false)
    config.enableWrites = config.enableOnboardingDrafts = config.enableOnboardingInvitations = true
    config.enableTenantCrmReads = true
    config.publicOrigin = 'https://tenant-crm.fixture.invalid'
    config.csrfSecret = 'fixture-only-tenant-crm-secret-1234567890'
    const fixture=await tenantCrmFixture()
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
      expect(response.status).toBe(200); await response.json()
      sessions.set(who, response.headers.get('set-cookie')!.split(';')[0]!)
    }
  }, 30_000)

  afterEach(async () => {
    config.enableTenantCrmReads = true; state.afterRead = null; state.failConnect = false; state.failAudit = false
    manifests.forEach((manifest, index) => state.targets.set(manifest.runtimeKey, targets[index]!))
    state.queries = []; state.readOnly = []; state.resolutions = 0
    await state.metadata!.query("UPDATE admin_company_access SET access_kind='owner' WHERE admin_id=11")
    await state.metadata!.query("UPDATE admin_onboarding_access SET role='manager',revoked_at=NULL WHERE invitation_id=$1", [viewerInvite])
    await state.metadata!.query('UPDATE admin_onboarding_app_configs SET config=$1 WHERE draft_id=$2',
      [JSON.stringify(application), manifests[0]!.source.draftId])
    const { __resetRateLimitBucketsForTests } = await import('../security.js'); __resetRateLimitBucketsForTests()
  })
  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()))
    for (const db of targets) await db.close()
    await state.metadata?.close()
  })

  const path = (index = 0, id = '1') => `/api/admin/onboarding/drafts/${manifests[index]!.source.draftId}/crm/customers/${id}`
  const request = (who: string | null, target = path(), method = 'GET') => fetch(origin + target,
    { method, headers: { ...(who ? { cookie: sessions.get(who)! } : {}), ...(method !== 'GET' ? { origin: config.publicOrigin } : {}) } })

  it('requires a real session and leaves the feature disabled without target access', async () => {
    expect((await request(null)).status).toBe(401)
    config.enableTenantCrmReads = false
    expect((await request('root')).status).toBe(403)
    expect(state.resolutions).toBe(0)
  })
  it('keeps identical customer IDs separate in two companies and two venues of one company', async () => {
    for (const [index, who] of ['owner', 'owner', 'south'].entries()) {
      const response = await request(who, path(index)); expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ schemaVersion: 1, scope: manifests[index]!.scope,
        readStatus: 'verified', runtimeStatus: 'not_provisioned', customer: { id: '1' }, wallet: { balance: String(101 + index) } })
    }
  })
  it('does not let another company owner or another super-admin use a draft they do not own', async () => {
    expect((await request('owner', path(2))).status).toBe(404)
    expect((await request('other-root')).status).toBe(404)
    expect(state.resolutions).toBe(0)
  })
  it('limits an invited manager to the selected venue, and denies viewer/revoked grants', async () => {
    expect((await request('trusted')).status).toBe(200)
    expect((await request('trusted', path(1))).status).toBe(404)
    await state.metadata!.query("UPDATE admin_onboarding_access SET role='viewer' WHERE invitation_id=$1", [viewerInvite])
    expect((await request('trusted')).status).toBe(403)
    await state.metadata!.query("UPDATE admin_onboarding_access SET role='manager',revoked_at=NOW() WHERE invitation_id=$1", [viewerInvite])
    expect((await request('trusted')).status).toBe(403)
  })
  it.each(['2', '4', '5', '999'])('returns the same not-found result for unowned/deleted/staff/absent customer %s', async id => {
    const response = await request('owner', path(0, id)); expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'TENANT_CRM_CUSTOMER_NOT_FOUND' })
  })
  it('distinguishes missing wallet from zero and preserves balances above JS safe integer precision', async () => {
    for (const [id, balance] of [['3', null], ['6', '0'], ['7', '9007199254740993']] as const) {
      const response = await request('owner', path(0, id)); expect(response.status).toBe(200)
      expect((await response.json()).wallet).toEqual(balance === null ? null : expect.objectContaining({ balance }))
    }
  })
  it('rejects request scope/credentials and invalid customer IDs before resolving a database', async () => {
    for (const suffix of ['?companyId=20', '?venueId=999', '?runtimeKey=foreign', '?databaseUrl=postgres://fixture.invalid/private'])
      expect((await request('owner', path() + suffix)).status).toBe(400)
    for (const id of ['0', '-1', '01', '9223372036854775808', '1%20OR%201=1'])
      expect((await request('owner', path(0, id))).status).toBe(400)
    expect(state.resolutions).toBe(0)
  })
  it('does not silently use legacy data when no tenant database is registered', async () => {
    state.targets.clear()
    const response = await request('owner'); expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'TENANT_CRM_SOURCE_NOT_CONFIGURED' })
    expect(state.queries).toEqual([])
  })
  it.each([1, 2])('rejects a registry binding pointing at another venue/company (target %s)', async index => {
    state.targets.set(manifests[0]!.runtimeKey, targets[index]!)
    const response = await request('owner'); expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain('Owned')
  })
  it('rechecks authorization after the customer read and suppresses data on revocation', async () => {
    state.afterRead = async () => { await state.metadata!.query("UPDATE admin_company_access SET access_kind='trusted' WHERE admin_id=11") }
    const response = await request('owner'); expect(response.status).toBe(403)
    expect(JSON.stringify(await response.json())).not.toContain('Owned')
    expect(state.queries.at(-1)).toBe('ROLLBACK')
  })
  it('sanitizes database failures without returning credentials', async () => {
    state.failConnect = true
    const response = await request('owner'); expect(response.status).toBe(503)
    const body = await response.json()
    expect(body).toMatchObject({ code: 'TENANT_CRM_READ_UNAVAILABLE' })
    expect(JSON.stringify(body)).not.toMatch(/postgres:|synthetic:secret|fixture\.invalid\/private/)
  })
  it('does not return a customer if the frozen configuration changes during a read', async () => {
    state.afterRead = async () => { await state.metadata!.query(`UPDATE admin_onboarding_app_configs
      SET config=jsonb_set(config,'{displayName}','"Changed during read"') WHERE draft_id=$1`, [manifests[0]!.source.draftId]) }
    const response = await request('owner'); expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain('Owned')
  })
  it('fails closed when access auditing cannot be persisted', async () => {
    state.failAudit = true
    const response = await request('owner'); expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain('Owned')
  })
  it('rate limits repeated reads per actor without contacting a target for invalid IDs', async () => {
    for (let count = 0; count < 30; count++) expect((await request('owner', path(0, '0'))).status).toBe(400)
    expect((await request('owner', path(0, '0'))).status).toBe(429)
    expect(state.resolutions).toBe(0)
  })
  const directory=(index=0,query='')=>path(index).slice(0,-2)+query
  it('requires a session and the feature flag for directory reads',async()=>{
    expect((await request(null,directory())).status).toBe(401)
    config.enableTenantCrmReads=false
    expect((await request('owner',directory())).status).toBe(403)
    const session=await request('owner','/api/admin/auth/session')
    expect((await session.json()).capabilities.tenantCrmReads).toBe(false)
    expect(state.resolutions).toBe(0)
  })
  it('paginates all 350 matching customers without truncation or duplicates',async()=>{
    const ids:string[]=[]
    for(let offset=0;offset<350;offset+=100){
      const response=await request('owner',directory(0,'?q=Pagination%20fixture&limit=100&offset='+offset))
      expect(response.status).toBe(200)
      const body=await response.json()
      expect(body).toMatchObject({q:'Pagination fixture',total:'350',limit:100,offset,hasMore:offset<300,
        scope:manifests[0]!.scope,readStatus:'verified',runtimeStatus:'not_provisioned'})
      ids.push(...body.items.map((item:{customer:{id:string}})=>item.customer.id))
    }
    expect(ids).toHaveLength(350);expect(new Set(ids).size).toBe(350)
    expect(ids[0]).toBe('1000');expect(ids.at(-1)).toBe('1349')
  })
  it('supports literal wildcard, Cyrillic and ID search without SQL injection',async()=>{
    for(const q of ['Анна','_100%','8']){
      const response=await request('owner',directory(0,'?q='+encodeURIComponent(q)))
      expect(response.status).toBe(200)
      const body=await response.json();expect(body.items.some((row:{customer:{id:string}})=>row.customer.id==='8')).toBe(true)
      if(q!=='8')expect(body).toMatchObject({total:'1'})
    }
    const injection=await request('owner',directory(0,'?q='+encodeURIComponent("' OR TRUE --")))
    expect(await injection.json()).toMatchObject({total:'0',items:[],hasMore:false})
  })
  it('keeps empty results, missing wallets, zero and exact bigint balances distinct',async()=>{
    const response=await request('owner',directory(0,'?limit=100'))
    expect(response.status).toBe(200)
    const rows=(await response.json()).items as {customer:{id:string};wallet:{balance:string}|null}[]
    expect(rows.find(row=>row.customer.id==='3')?.wallet).toBeNull()
    expect(rows.find(row=>row.customer.id==='6')?.wallet?.balance).toBe('0')
    expect(rows.find(row=>row.customer.id==='7')?.wallet?.balance).toBe('9007199254740993')
    expect(rows.some(row=>['2','4','5'].includes(row.customer.id))).toBe(false)
    expect(await (await request('owner',directory(0,'?q=Definitely%20not%20found'))).json()).toMatchObject({total:'0',items:[],hasMore:false,readStatus:'verified'})
  })
  it('isolates directory reads across two companies and two venues, including invited managers',async()=>{
    for(const [index,who] of ['owner','owner','south'].entries()){
      const response=await request(who,directory(index,'?q=Owned'))
      expect(response.status).toBe(200)
      expect((await response.json()).items[0].wallet.balance).toBe(String(101+index))
    }
    expect((await request('owner',directory(2))).status).toBe(404)
    expect((await request('other-root',directory())).status).toBe(404)
    expect((await request('trusted',directory())).status).toBe(200)
    expect((await request('trusted',directory(1))).status).toBe(404)
    await state.metadata!.query("UPDATE admin_onboarding_access SET role='viewer' WHERE invitation_id=$1",[viewerInvite])
    expect((await request('trusted',directory())).status).toBe(403)
  })
  it('rejects scope, duplicate and noncanonical pagination parameters before target resolution',async()=>{
    for(const query of ['companyId=20','venueId=20','runtimeKey=foreign','databaseUrl=postgres://fixture.invalid',
      'q=a&q=b','limit=1&limit=2','offset=0&offset=1','limit=0','limit=101','limit=01','limit=1e2','limit=-1',
      'offset=1000001','offset=00','offset=0.5','q='+('x'.repeat(101))])
      expect((await request('owner',directory(0,'?'+query))).status).toBe(400)
    expect(state.resolutions).toBe(0)
  })
  it('refuses directory mutations and missing or wrongly registered target databases',async()=>{
    expect((await request('owner',directory(),'POST')).status).toBe(405)
    state.targets.clear()
    expect((await request('owner',directory())).status).toBe(409)
    state.targets.set(manifests[0]!.runtimeKey,targets[1]!)
    const mismatch=await request('owner',directory());expect(mismatch.status).toBe(503)
    expect(JSON.stringify(await mismatch.json())).not.toContain('Owned')
  })
  it('suppresses directory PII after an access revocation during the target read',async()=>{
    state.afterRead=async()=>{await state.metadata!.query("UPDATE admin_company_access SET access_kind='trusted' WHERE admin_id=11")}
    const response=await request('owner',directory());expect(response.status).toBe(403)
    expect(JSON.stringify(await response.json())).not.toContain('Owned')
    expect(state.queries.at(-1)).toBe('ROLLBACK')
  })
  it('suppresses directory PII when the frozen manifest changes during the read',async()=>{
    state.afterRead=async()=>{await state.metadata!.query(`UPDATE admin_onboarding_app_configs SET config=jsonb_set(config,'{displayName}','"Changed"') WHERE draft_id=$1`,[manifests[0]!.source.draftId])}
    const response=await request('owner',directory());expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain('Owned')
  })
  it('fails closed on directory audit errors and does not log names, search text or balances',async()=>{
    state.failAudit=true
    const failed=await request('owner',directory());expect(failed.status).toBe(503)
    expect(JSON.stringify(await failed.json())).not.toContain('Owned')
    state.failAudit=false
    expect((await request('owner',directory(0,'?q=Owned'))).status).toBe(200)
    const audit=(await state.metadata!.query(`SELECT metadata,after_value FROM admin_audit_log
      WHERE action='crm.customer_directory_read' ORDER BY id DESC LIMIT 1`)).rows[0]
    expect(audit).toEqual({metadata:{purpose:'onboarding_read_diagnostic'},after_value:null})
  })
  it('shares the actor rate limit between directory and individual customer reads',async()=>{
    for(let index=0;index<15;index++){
      expect((await request('owner',directory(0,'?limit=0'))).status).toBe(400)
      expect((await request('owner',path(0,'0'))).status).toBe(400)
    }
    expect((await request('owner',directory())).status).toBe(429)
    expect(state.resolutions).toBe(0)
  })
  it('uses a read-only snapshot, rejects mutations, and keeps metadata legacy balances unchanged', async () => {
    expect((await request('owner', path(), 'POST')).status).toBe(405)
    expect((await request('owner')).status).toBe(200)
    expect(state.queries[0]).toBe('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    expect(state.queries.at(-1)).toBe('COMMIT')
    expect(state.readOnly).toEqual(['on'])
    expect(state.queries[1]).toBe("SET LOCAL statement_timeout='5s'")
    expect(state.queries.every(text => text==="SET LOCAL statement_timeout='5s'"||/^(BEGIN|SELECT|WITH|COMMIT|ROLLBACK)\b/.test(text))).toBe(true)
    expect((await state.metadata!.query('SELECT balance::text FROM wallets WHERE id=1')).rows).toEqual([{ balance: '100' }])
    const audit = (await state.metadata!.query(`SELECT company_id::text,venue_id::text,metadata,after_value
      FROM admin_audit_log WHERE action='crm.customer_read' ORDER BY id DESC LIMIT 1`)).rows[0]
    expect(audit).toMatchObject({ company_id: manifests[0]!.scope.companyId, venue_id: manifests[0]!.scope.venueId,
      metadata: { purpose: 'onboarding_read_diagnostic' }, after_value: null })
  })
})
