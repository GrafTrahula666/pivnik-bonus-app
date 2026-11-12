// @vitest-environment node
import fs from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ db: null as PGlite | null, failAudit: false }))
vi.mock('../db.js', () => {
  const query = async (sql: string, params?: unknown[]) => {
    if (state.failAudit && sql.startsWith('INSERT INTO admin_audit_log')) {
      throw new Error('Synthetic audit failure; should never appear in the HTTP response')
    }
    const res = await state.db!.query(sql, params)
    return { ...res, rowCount: res.rows.length || res.affectedRows || 0 }
  }
  const adapter = { query, connect: async () => ({ query, release() {} }) }
  return { pool: adapter, readPool: adapter, writePool: null,
    tableExists: async () => false, productionTableExists: async () => false }
})

describe('CHAT 04 #492: durable, internal-only owner signup confirmation ledger', () => {
  let config: typeof import('../config.js').config
  let prepare: typeof import('../owner-signup-challenges.js').prepareOwnerSignupChallenge
  let confirm: typeof import('../owner-signup-challenges.js').confirmOwnerSignupChallenge
  const password = 'Verified-Owner-Only-2026!'
  const signup = (email: string) => ({ email, displayName: 'Test owner', password })
  const tokens = new Map<string, string>()
  const delivered = async (email: string, token: string) => { tokens.set(email, token) }

  beforeAll(async () => {
    const { onboardingFixture } = await import('./onboarding-fixture.js')
    state.db = await onboardingFixture()
    const { config: loaded } = await import('../config.js')
    config = loaded
    config.enableWrites = config.enableOnboardingDrafts = config.enableOwnerSignup = true
    const originalWallet = await state.db!.query('SELECT balance FROM wallets WHERE id=1')
    expect(originalWallet.rows).toEqual([{ balance: 100 }])
    const sql = await fs.readFile(new URL('../../admin-migrations/027_owner_signup_challenges.sql', import.meta.url), 'utf8')
    expect(sql).not.toMatch(/(?:^|\n)\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/i)
    await state.db!.exec(sql)
    await state.db!.exec(sql) // migration must be repeatable
    const service = await import('../owner-signup-challenges.js')
    prepare = service.prepareOwnerSignupChallenge
    confirm = service.confirmOwnerSignupChallenge
  }, 30_000)
  afterAll(async () => {
    state.failAudit = false
    if (config) config.enableWrites = config.enableOnboardingDrafts = config.enableOwnerSignup = false
    await state.db?.close()
  })

  it('does not issue a challenge without an explicitly injected delivery provider', async () => {
    await expect(prepare(signup('no-delivery@fixture.invalid'), null))
      .rejects.toMatchObject({ statusCode: 503, code: 'OWNER_SIGNUP_VERIFICATION_UNAVAILABLE' })
    expect((await state.db!.query("SELECT 1 FROM admin_owner_signup_challenges WHERE email='no-delivery@fixture.invalid'")).rows).toEqual([])
  })

  it('stores only a token hash, then creates a no-tenant VENUE_ADMIN after verification', async () => {
    const email = 'verified-first@fixture.invalid'
    await expect(prepare(signup(email), delivered)).resolves.toEqual({ accepted: true })
    const token = tokens.get(email)!
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const pending = (await state.db!.query<{token_hash: string;password_hash:string}>(
      'SELECT token_hash,password_hash FROM admin_owner_signup_challenges WHERE email=$1', [email],
    )).rows[0]!
    expect(pending.token_hash).not.toContain(token)
    expect(pending.password_hash).not.toContain(password)
    expect((await state.db!.query('SELECT 1 FROM admin_accounts WHERE email=$1',[email])).rows).toEqual([])
    const result = await confirm(token)
    expect(result.admin).toMatchObject({ email, role: 'VENUE_ADMIN' })
    const memberships = await state.db!.query('SELECT 1 FROM admin_company_access WHERE admin_id=$1::bigint',[result.admin.id])
    expect(memberships.rows).toEqual([])
    const grants = await state.db!.query('SELECT 1 FROM admin_onboarding_access WHERE admin_id=$1::bigint',[result.admin.id])
    expect(grants.rows).toEqual([])
    expect((await state.db!.query('SELECT balance FROM wallets WHERE id=1')).rows).toEqual([{balance:100}])
    const audit = await state.db!.query('SELECT action,metadata FROM admin_audit_log WHERE admin_id=$1::bigint',[result.admin.id])
    expect(audit.rows).toMatchObject([{action:'auth.owner_signup_verified',metadata:{emailVerified:true,noTenantGrant:true}}])
    expect(JSON.stringify(audit.rows)).not.toContain(token)
    expect(JSON.stringify(audit.rows)).not.toContain(password)
    await expect(confirm(token)).rejects.toMatchObject({statusCode:410,code:'OWNER_SIGNUP_TOKEN_UNAVAILABLE'})
  })

  it('does not send new invitations to an already registered email', async () => {
    const email = 'owner@fixture.invalid'
    const before = tokens.size
    await expect(prepare(signup(email), delivered)).resolves.toEqual({accepted:true})
    expect(tokens.size).toBe(before)
    expect((await state.db!.query('SELECT 1 FROM admin_owner_signup_challenges WHERE email=$1',[email])).rows).toEqual([])
  })

  it('a reissued challenge revokes the previous token, with no account creation', async () => {
    const email = 'reissue@fixture.invalid'
    await prepare(signup(email), delivered)
    const first = tokens.get(email)!
    await prepare(signup(email), delivered)
    const second = tokens.get(email)!
    expect(first).not.toBe(second)
    await expect(confirm(first)).rejects.toMatchObject({statusCode:410})
    expect((await state.db!.query('SELECT 1 FROM admin_accounts WHERE email=$1',[email])).rows).toEqual([])
    await expect(confirm(second)).resolves.toMatchObject({admin:{email,role:'VENUE_ADMIN'}})
  })

  it('expired and malformed tokens cannot create accounts', async () => {
    const email = 'expired@fixture.invalid'
    await prepare(signup(email), delivered)
    await state.db!.query("UPDATE admin_owner_signup_challenges SET created_at=NOW()-INTERVAL '2 hours', expires_at=NOW()-INTERVAL '1 hour' WHERE email=$1",[email])
    await expect(confirm(tokens.get(email)!)).rejects.toMatchObject({statusCode:410})
    await expect(confirm('not-a-token')).rejects.toMatchObject({statusCode:410})
    expect((await state.db!.query('SELECT 1 FROM admin_accounts WHERE email=$1',[email])).rows).toEqual([])
  })

  it('audit failure rolls back account and token consumption atomically', async () => {
    const email = 'audit-fail@fixture.invalid'
    await prepare(signup(email), delivered)
    const token = tokens.get(email)!
    state.failAudit = true
    try {
      await expect(confirm(token)).rejects.toMatchObject({statusCode:503,code:'OWNER_SIGNUP_STORAGE_UNAVAILABLE'})
    } finally { state.failAudit = false }
    expect((await state.db!.query('SELECT 1 FROM admin_accounts WHERE email=$1',[email])).rows).toEqual([])
    expect((await state.db!.query('SELECT consumed_at FROM admin_owner_signup_challenges WHERE email=$1',[email])).rows)
      .toEqual([{consumed_at:null}])
    await expect(confirm(token)).resolves.toMatchObject({admin:{email}})
  })

  it('same normalized email cannot be used to capture an existing account', async () => {
    const email = 'collision@fixture.invalid'
    await prepare(signup(email), delivered)
    const token = tokens.get(email)!
    const {hashPassword} = await import('../security.js')
    await state.db!.query(
      "INSERT INTO admin_accounts(email,display_name,role,password_hash) VALUES($1,'Other','VENUE_ADMIN',$2)",
      [email,hashPassword('Other-Verified-Password-2026!')],
    )
    await expect(confirm(token)).rejects.toMatchObject({statusCode:410,code:'OWNER_SIGNUP_TOKEN_UNAVAILABLE'})
    expect((await state.db!.query('SELECT count(*)::int AS n FROM admin_accounts WHERE email=$1',[email])).rows)
      .toEqual([{n:1}])
  })

  it('all feature gates are checked before issuing or consuming tokens', async () => {
    const email = 'disabled@fixture.invalid'
    config.enableOwnerSignup = false
    try {
      await expect(prepare(signup(email), delivered)).rejects.toMatchObject({statusCode:403,code:'OWNER_SIGNUP_DISABLED'})
      await expect(confirm(tokens.get('verified-first@fixture.invalid')!)).rejects.toMatchObject({statusCode:403})
      expect((await state.db!.query('SELECT 1 FROM admin_owner_signup_challenges WHERE email=$1',[email])).rows).toEqual([])
    } finally { config.enableOwnerSignup = true }
  })
})
