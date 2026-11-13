// @vitest-environment node
// CHAT 04 #492: native PostgreSQL lock/wait and single-use verification.
// Only run against the disposable, EMPTY codex_admin_test_signup database.
import fs from 'node:fs/promises'
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

suite('CHAT 04 native PostgreSQL confirmation locking', () => {
  let config: typeof import('../config.js').config
  let restore: { enableWrites: boolean; enableOnboardingDrafts: boolean; enableOwnerSignup: boolean }
  let prepare: typeof import('../owner-signup-challenges.js').prepareOwnerSignupChallenge
  let confirm: typeof import('../owner-signup-challenges.js').confirmOwnerSignupChallenge
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
        password_hash TEXT NOT NULL
      );
      CREATE UNIQUE INDEX signup_test_account_email ON admin_accounts(LOWER(email));
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
    }
    config.enableWrites = config.enableOnboardingDrafts = config.enableOwnerSignup = true
    const service = await import('../owner-signup-challenges.js')
    prepare = service.prepareOwnerSignupChallenge
    confirm = service.confirmOwnerSignupChallenge
  }, 30_000)

  afterAll(async () => {
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
        const locks = await blocker.query(`
          SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event_type='Lock'
            AND query LIKE '%admin_owner_signup_challenges%'
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
})
