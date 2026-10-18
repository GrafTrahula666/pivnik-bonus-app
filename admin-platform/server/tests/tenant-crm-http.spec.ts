// @vitest-environment node
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createSpaceverseRuntimeManifest, type SpaceverseRuntimeManifest } from '../../../spaceverse-runtime-manifest.js'
import { config } from '../config.js'
import { seedOnboardingFixture, fixturePassword } from './onboarding-fixture.js'
import { tenantCrmFixtureDatabase, type TenantCrmFixtureDatabase } from './tenant-crm-database-fixture.js'

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
  const application = { displayName: 'Synthetic CRM', theme: 'premium-dark' as const,
    primaryColor: '#73bcd9', secondaryColor: '#172c36', shopEnabled: true, loyaltyEnabled: true }

  beforeAll(async () => {
    expect(config.enableTenantCrmReads).toBe(false)
    config.enableWrites = config.enableOnboardingDrafts = config.enableOnboardingInvitations = true
    config.enableTenantCrmReads = true
    config.publicOrigin = 'https://tenant-crm.fixture.invalid'
    config.csrfSecret = 'fixture-only-tenant-crm-secret-1234567890'
    state.metadata = await seedOnboardingFixture(await tenantCrmFixtureDatabase())
    const passwordHash = (await state.metadata.query<{ password_hash: string }>('SELECT password_hash FROM admin_accounts WHERE id=11')).rows[0]!.password_hash
    await state.metadata.query(`INSERT INTO admin_accounts(id,email,display_name,role,password_hash)
      VALUES(21,'south@fixture.invalid','south','VENUE_ADMIN',$1)`, [passwordHash])
    await state.metadata.exec("INSERT INTO admin_company_access(admin_id,company_id,access_kind) VALUES(21,20,'owner')")
    for (const [index, company] of ['10', '10', '20'].entries()) {
      const draftId = crypto.randomUUID(), runtimeKey = 'sv-' + draftId.replaceAll('-', '')
      const venue = (await state.metadata.query<{ id: string }>(`INSERT INTO venues(company_id,code,name,active)
        VALUES($1,$2,'Synthetic CRM',FALSE) RETURNING id::text`, [company, runtimeKey])).rows[0]!
      await state.metadata.query(`INSERT INTO admin_onboarding_drafts(id,admin_id,company_id,request_key,initial_hash,data)
        VALUES($1,1,$2,$3,$4,'{}')`, [draftId, company, crypto.randomUUID(), 'a'.repeat(64)])
      await state.metadata.query('INSERT INTO admin_onboarding_app_configs(draft_id,tenant_key,config) VALUES($1,$2,$3)',
        [draftId, runtimeKey, JSON.stringify(application)])
      await state.metadata.query(`INSERT INTO admin_onboarding_scopes(draft_id,company_id,venue_id,
        company_created_by_onboarding,draft_revision,application_revision) VALUES($1,$2,$3,FALSE,1,1)`, [draftId, company, venue.id])
      const manifest = createSpaceverseRuntimeManifest({ draftId, runtimeKey, draftRevision: 1,
        applicationRevision: 1, scopeRevision: 1, scope: { companyId: company, venueId: venue.id }, config: application })
      manifests.push(manifest)
      const db = await tenantCrmFixtureDatabase(); targets.push(db)
      for (const file of ['017_spaceverse_runtime_binding.sql', '018_spaceverse_runtime_scope_binding.sql'])
        await db.exec(await fs.readFile(new URL('../../../migrations/' + file, import.meta.url), 'utf8'))
      await db.exec(`CREATE TABLE users(id BIGINT PRIMARY KEY,username TEXT,first_name TEXT,last_name TEXT,photo_url TEXT,
        role TEXT DEFAULT 'client',deleted_at TIMESTAMPTZ,merged_into_user_id BIGINT);
        CREATE TABLE wallets(user_id BIGINT PRIMARY KEY REFERENCES users(id),balance BIGINT,updated_at TIMESTAMPTZ DEFAULT NOW());
        INSERT INTO users(id,first_name) VALUES(1,'Owned'),(2,'Historical'),(3,'No wallet'),(4,'Deleted'),(5,'Staff'),(6,'Zero'),(7,'Large');
        UPDATE users SET deleted_at=NOW() WHERE id=4; UPDATE users SET role='staff' WHERE id=5;`)
      await db.exec(await fs.readFile(new URL('../../../migrations/019_spaceverse_customer_ownership.sql', import.meta.url), 'utf8'))
      await db.query(`INSERT INTO spaceverse_runtime_binding(singleton,runtime_key,manifest_sha256,manifest_revision,
        company_id,venue_id,isolation_policy,status) VALUES(TRUE,$1,$2,1,$3,$4,'dedicated_database','prepared')`,
      [runtimeKey, manifest.manifestSha256, company, venue.id])
      for (const id of [1, 3, 4, 5, 6, 7]) await db.query(`INSERT INTO spaceverse_customer_ownership(user_id,runtime_key,company_id,venue_id)
        VALUES($1,$2,$3,$4)`, [id, runtimeKey, company, venue.id])
      await db.query('INSERT INTO wallets(user_id,balance) VALUES(1,$1),(2,999),(6,0),(7,9007199254740993)', [String(101 + index)])
      state.targets.set(runtimeKey, db)
    }
    viewerInvite = crypto.randomUUID()
    const first = manifests[0]!
    await state.metadata.query(`INSERT INTO admin_onboarding_invites(id,draft_id,token_hash,created_by_admin_id,expires_at)
      VALUES($1,$2,$3,1,NOW()+INTERVAL '1 day')`, [viewerInvite, first.source.draftId, 'b'.repeat(64)])
    await state.metadata.query(`INSERT INTO admin_onboarding_access(invitation_id,admin_id,company_id,venue_id,draft_id,role)
      VALUES($1,12,10,$2,$3,'manager')`, [viewerInvite, first.scope.venueId, first.source.draftId])
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
  it('uses a read-only snapshot, rejects mutations, and keeps metadata legacy balances unchanged', async () => {
    expect((await request('owner', path(), 'POST')).status).toBe(405)
    expect((await request('owner')).status).toBe(200)
    expect(state.queries[0]).toBe('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    expect(state.queries.at(-1)).toBe('COMMIT')
    expect(state.readOnly).toEqual(['on'])
    expect(state.queries.every(text => /^(BEGIN|SELECT|WITH|COMMIT|ROLLBACK)\b/.test(text))).toBe(true)
    expect((await state.metadata!.query('SELECT balance::text FROM wallets WHERE id=1')).rows).toEqual([{ balance: '100' }])
    const audit = (await state.metadata!.query(`SELECT company_id::text,venue_id::text,metadata,after_value
      FROM admin_audit_log WHERE action='crm.customer_read' ORDER BY id DESC LIMIT 1`)).rows[0]
    expect(audit).toMatchObject({ company_id: manifests[0]!.scope.companyId, venue_id: manifests[0]!.scope.venueId,
      metadata: { purpose: 'onboarding_read_diagnostic' }, after_value: null })
  })
})
