// @vitest-environment node
// CHAT 04 #492: native PostgreSQL lock/wait and single-use verification.
// Only run against the disposable, EMPTY codex_admin_test_signup database.
import fs from 'node:fs/promises'
import http from 'node:http'
import pg, { type Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ pool: null as Pool | null }))
vi.mock('../db.js', () => ({
  pool: {
    connect: () => state.pool!.connect(),
    query: (sql: string, params?: unknown[]) => state.pool!.query(sql, params),
  },
  readPool: null,
  writePool: null,
  tableExists: async () => false,
  productionTableExists: async () => false,
}))

const databaseUrl = String(process.env.CHAT04_NATIVE_TEST_DATABASE_URL || '')
let permitted = false
try {
  const u = new URL(databaseUrl)
  permitted = u.pathname === '/codex_admin_test_signup'
    && ['127.0.0.1', 'localhost'].includes(u.hostname)
    && u.protocol === 'postgres:'
} catch { /* fail closed */ }
const suite = databaseUrl && permitted ? describe : describe.skip

suite('CHAT 04 native PostgreSQL signup HTTP, sessions and confirmation locking', () => {
  let config: typeof import('../config.js').config
  let restore: { enableWrites: boolean; enableOnboardingDrafts: boolean; enableOwnerSignup: boolean; publicOrigin: string }
  let prepare: typeof import('../owner-signup-challenges.js').prepareOwnerSignupChallenge
  let confirm: typeof import('../owner-signup-challenges.js').confirmOwnerSignupChallenge
  let setTestDelivery: typeof import('../owner-signup-challenges.js').setOwnerSignupTestDelivery
  let server: http.Server | null = null
  let endpoint = ''
  const validOrigin = 'https://owner-signup.native.fixture.invalid'
  const tokens = new Map<string, string>()
  const password = 'Native-Owner-Verified-2026!'

  beforeAll(async () => {
    state.pool = new pg.Pool({ connectionString: databaseUrl, max: 6, ssl: false })
    const database = await state.pool.query('SELECT current_database() AS name')
    expect(database.rows[0].name).toBe('codex_admin_test_signup')
    const existing = await state.pool.query(
      "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'",
    )
    // Never clean/drop a populated schema or accidentally adopt another fixture.
    expect(existing.rows[0].n).toBe(0)
    await state.pool.query(`
      CREATE TABLE admin_accounts (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('SUPER_ADMIN','VENUE_ADMIN')),
        password_hash TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        last_login_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX signup_test_account_email ON admin_accounts(LOWER(email));
      CREATE TABLE admin_sessions (
        token_hash TEXT PRIMARY KEY,
        admin_id BIGINT NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        user_agent TEXT,
        ip_hash TEXT,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE admin_company_access (
        admin_id BIGINT NOT NULL,
        company_id BIGINT NOT NULL,
        access_kind TEXT NOT NULL,
        PRIMARY KEY(admin_id, company_id)
      );
      CREATE TABLE admin_onboarding_access (
        invitation_id UUID,
        admin_id BIGINT NOT NULL,
        company_id BIGINT NOT NULL,
        venue_id BIGINT,
        draft_id UUID,
        role TEXT NOT NULL,
        revoked_at TIMESTAMPTZ
      );
      CREATE TABLE admin_audit_log (
        id BIGSERIAL PRIMARY KEY,
        admin_id BIGINT REFERENCES admin_accounts(id),
        admin_role TEXT NOT NULL,
        company_id BIGINT, venue_id BIGINT,
        action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT,
        before_value JSONB, after_value JSONB, reason TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb
      );
    `)
    const migration = await fs.readFile(
      new URL('../../admin-migrations/027_owner_signup_challenges.sql', import.meta.url), 'utf8',
    )
    await state.pool.query(migration)
    const { config: settings } = await import('../config.js')
    config = settings
    restore = {
      enableWrites: config.enableWrites,
      enableOnboardingDrafts: config.enableOnboardingDrafts,
      enableOwnerSignup: config.enableOwnerSignup,
      publicOrigin: config.publicOrigin,
    }
    config.enableWrites = config.enableOnboardingDrafts = config.enableOwnerSignup = true
    config.publicOrigin = validOrigin
    const service = await import('../owner-signup-challenges.js')
    prepare = service.prepareOwnerSignupChallenge
    confirm = service.confirmOwnerSignupChallenge
    setTestDelivery = service.setOwnerSignupTestDelivery
    const { handleApi, sendApiError } = await import('../router.js')
    server = http.createServer((req, res) => {
      void handleApi(req, res, new URL(req.url || '/', endpoint))
        .catch(error => sendApiError(res, error, req))
    })
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject)
      server!.listen(0, '127.0.0.1', resolve)
    })
    endpoint = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
  }, 30_000)

  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) =>
      server!.close(error => error ? reject(error) : resolve()))
    if (setTestDelivery) setTestDelivery(null)
    if (config && restore) Object.assign(config, restore)
    await state.pool?.end()
    state.pool = null
  })

  async function challenge(email: string): Promise<string> {
    await prepare({ email, displayName: 'Native test owner', password },
      async (recipient, token) => { tokens.set(recipient, token) })
    const token = tokens.get(email)
    if (!token) throw new Error('Synthetic test sender did not capture token')
    return token
  }

  async function post(path: string, body: unknown, origin = validOrigin): Promise<Response> {
    return fetch(endpoint + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify(body),
    })
  }

  it('runs synthetic HTTP signup, confirmation, existing login and session without tenant grants', async () => {
    const email = 'native-http-owner@fixture.invalid'
    const httpPassword = 'Native-HTTP-Owner-2026!'
    tokens.delete(email)
    setTestDelivery(async (recipient, token) => {
      expect(recipient).toBe(email)
      tokens.set(recipient, token)
    })
    try {
      const started = await post('/api/admin/auth/signup', {
        email, displayName: 'Native HTTP owner', password: httpPassword,
      })
      expect(started.status).toBe(202)
      const startPayload = await started.json()
      expect(startPayload).toEqual({ ok: true, verification: 'pending' })
      const token = tokens.get(email)
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(JSON.stringify(startPayload)).not.toContain(token)
      const stored = await state.pool!.query(
        'SELECT token_hash FROM admin_owner_signup_challenges WHERE email=$1', [email],
      )
      const { sha256 } = await import('../security.js')
      expect(stored.rows[0].token_hash).toBe(sha256(token!))
      expect((await state.pool!.query('SELECT 1 FROM admin_accounts WHERE email=$1', [email])).rows).toEqual([])

      const wrongOrigin = await post('/api/admin/auth/signup/confirm', { token }, 'https://outside.native.fixture.invalid')
      expect(wrongOrigin.status).toBe(403)
      expect(await wrongOrigin.json()).toMatchObject({ code: 'ORIGIN_REJECTED' })

      const confirmed = await post('/api/admin/auth/signup/confirm', { token })
      expect(confirmed.status).toBe(200)
      expect(await confirmed.json()).toEqual({ ok: true, verified: true })
      expect((await state.pool!.query('SELECT count(*)::int AS n FROM admin_accounts WHERE email=$1', [email])).rows[0].n).toBe(1)
      expect((await state.pool!.query('SELECT count(*)::int AS n FROM admin_sessions s JOIN admin_accounts a ON a.id=s.admin_id WHERE a.email=$1', [email])).rows[0].n).toBe(0)

      const replay = await post('/api/admin/auth/signup/confirm', { token })
      expect(replay.status).toBe(410)
      expect(await replay.json()).toMatchObject({ code: 'OWNER_SIGNUP_TOKEN_UNAVAILABLE' })

      const loggedIn = await post('/api/admin/auth/login', { email, password: httpPassword })
      expect(loggedIn.status).toBe(200)
      const loginPayload = await loggedIn.json()
      expect(loginPayload.admin).toMatchObject({ email, role: 'VENUE_ADMIN' })
      expect(typeof loginPayload.csrfToken).toBe('string')
      const setCookie = loggedIn.headers.get('set-cookie') || ''
      const cookie = setCookie.split(';', 1)[0]!
      expect(cookie.startsWith(`${config.sessionCookie}=`)).toBe(true)

      const session = await fetch(endpoint + '/api/admin/auth/session', { headers: { cookie } })
      expect(session.status).toBe(200)
      const sessionPayload = await session.json()
      expect(sessionPayload.admin).toMatchObject({ email, role: 'VENUE_ADMIN' })
      const adminId = sessionPayload.admin.id
      expect((await state.pool!.query('SELECT 1 FROM admin_company_access WHERE admin_id=$1::bigint', [adminId])).rows).toEqual([])
      expect((await state.pool!.query('SELECT 1 FROM admin_onboarding_access WHERE admin_id=$1::bigint', [adminId])).rows).toEqual([])
      const audit = await state.pool!.query(
        "SELECT action,metadata FROM admin_audit_log WHERE admin_id=$1::bigint ORDER BY id", [adminId],
      )
      expect(audit.rows.map(row => row.action)).toContain('auth.owner_signup_verified')
      expect(audit.rows.map(row => row.action)).toContain('auth.login')
      expect(JSON.stringify(audit.rows)).not.toContain(token)
      expect(JSON.stringify(audit.rows)).not.toContain(httpPassword)
    } finally {
      setTestDelivery(null)
    }
  }, 30_000)

  it('rejects expiry while waiting on a real FOR UPDATE lock without creating an account', async () => {
    const email = 'native-expiry@fixture.invalid'
    const token = await challenge(email)
    // Preserve migration CHECK expires_at > created_at.
    await state.pool!.query(`
      UPDATE admin_owner_signup_challenges
      SET created_at=clock_timestamp()-INTERVAL '1 hour',
          expires_at=clock_timestamp()+INTERVAL '2 seconds'
      WHERE email=$1
    `, [email])
    const blocker = await state.pool!.connect()
    // pg_stat_activity snapshots are cached inside a transaction. Observe
    // contention from a separate autocommit connection, never from blocker.
    const monitor = await state.pool!.connect()
    let locked = false
    try {
      await blocker.query('BEGIN')
      await blocker.query('SELECT id FROM admin_owner_signup_challenges WHERE email=$1 FOR UPDATE', [email])
      locked = true

      // Handle expected rejection immediately to avoid unhandled promise rejections.
      const attempt = confirm(token).then(
        () => ({ ok: true, code: '' }),
        (error: { code?: string }) => ({ ok: false, code: error.code || '' }),
      )
      // Observe actual PG blocking rather than assuming a timer means contention.
      let waiting = false
      for (let i = 0; i < 40; i++) {
        const locks = await monitor.query(`
          SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event_type='Lock'
            AND pid<>pg_backend_pid()
        `)
        if (locks.rows[0].n > 0) { waiting = true; break }
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      expect(waiting).toBe(true)
      const delay = await state.pool!.query(
        "SELECT GREATEST(0, EXTRACT(EPOCH FROM (SELECT expires_at FROM admin_owner_signup_challenges WHERE email=$1)-clock_timestamp())) AS remaining",
        [email],
      )
      const seconds = Number(delay.rows[0].remaining)
      await new Promise(resolve => setTimeout(resolve, Math.max(0, seconds * 1000) + 250))
      await blocker.query('COMMIT')
      locked = false
      expect(await attempt).toEqual({ ok: false, code: 'OWNER_SIGNUP_TOKEN_UNAVAILABLE' })
      expect((await state.pool!.query('SELECT 1 FROM admin_accounts WHERE email=$1', [email])).rowCount).toBe(0)
      expect((await state.pool!.query(
        'SELECT consumed_at FROM admin_owner_signup_challenges WHERE email=$1', [email],
      )).rows[0].consumed_at).toBeNull()
    } finally {
      if (locked) await blocker.query('ROLLBACK').catch(() => undefined)
      blocker.release()
      monitor.release()
    }
  }, 20_000)

  it('allows only one winner for two concurrent confirmations of the same token', async () => {
    const email = 'native-replay@fixture.invalid'
    const token = await challenge(email)
    const results = await Promise.allSettled([confirm(token), confirm(token)])
    const accepted = results.filter(result => result.status === 'fulfilled')
    const rejected = results.filter(result => result.status === 'rejected')
    expect(accepted).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    if (rejected[0].status === 'rejected') {
      expect(rejected[0].reason).toMatchObject({ code: 'OWNER_SIGNUP_TOKEN_UNAVAILABLE' })
    }
    const accounts = await state.pool!.query(
      'SELECT id::text,role FROM admin_accounts WHERE email=$1', [email],
    )
    expect(accounts.rows).toHaveLength(1)
    expect(accounts.rows[0].role).toBe('VENUE_ADMIN')
    const audits = await state.pool!.query(
      "SELECT 1 FROM admin_audit_log WHERE action='auth.owner_signup_verified' AND admin_id=$1",
      [accounts.rows[0].id],
    )
    expect(audits.rows).toHaveLength(1)
  }, 20_000)
  it('keeps independent verified owners separate and rejects cross-token replay', async () => {
    const emails = ['native-owner-a@fixture.invalid', 'native-owner-b@fixture.invalid']
    const [tokenA, tokenB] = await Promise.all(emails.map(challenge))
    expect(tokenA).not.toBe(tokenB)

    const [resultA, resultB] = await Promise.all([confirm(tokenA), confirm(tokenB)])
    expect(resultA.admin.id).not.toBe(resultB.admin.id)
    expect(resultA.admin.email).toBe(emails[0])
    expect(resultB.admin.email).toBe(emails[1])
    expect(resultA.admin.role).toBe('VENUE_ADMIN')
    expect(resultB.admin.role).toBe('VENUE_ADMIN')

    const accounts = await state.pool!.query(
      'SELECT id::text,email,role FROM admin_accounts WHERE email=ANY($1::text[]) ORDER BY email',
      [emails],
    )
    expect(accounts.rows).toHaveLength(2)
    expect(accounts.rows.map(row => row.email)).toEqual(emails)
    expect(accounts.rows.every(row => row.role === 'VENUE_ADMIN')).toBe(true)
    const audits = await state.pool!.query(
      "SELECT admin_id::text FROM admin_audit_log WHERE action='auth.owner_signup_verified' AND admin_id::text=ANY($1::text[])",
      [accounts.rows.map(row => row.id)],
    )
    expect(audits.rows).toHaveLength(2)

    await expect(confirm(tokenA)).rejects.toMatchObject({ code: 'OWNER_SIGNUP_TOKEN_UNAVAILABLE' })
    await expect(confirm(tokenB)).rejects.toMatchObject({ code: 'OWNER_SIGNUP_TOKEN_UNAVAILABLE' })
    const unchanged = await state.pool!.query(
      'SELECT count(*)::int AS n FROM admin_accounts WHERE email=ANY($1::text[])', [emails],
    )
    expect(unchanged.rows[0].n).toBe(2)
  }, 20_000)

})
