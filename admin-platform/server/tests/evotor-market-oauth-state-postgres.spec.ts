// @vitest-environment node
// Disposable native PostgreSQL ONLY. No live Evotor/provider or production DB.
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import pg from 'pg'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { issueEvotorOAuthState, consumeEvotorOAuthState } from '../evotor-market-oauth-state.js'

const connectionString = String(process.env.ADMIN_INTEGRATION_TEST_DATABASE_URL || '')
const disposable = (() => {
  try { return /^codex_admin_test(?:_|$)/.test(decodeURIComponent(new URL(connectionString).pathname.slice(1))) }
  catch { return false }
})()
const native = connectionString && disposable ? describe : describe.skip
const productId = 'c0d01535-5193-4cc2-9bfb-be20e0679498'
const otherProductId = 'd0d01535-5193-4cc2-9bfb-be20e0679498'
const redirectUri = 'https://spaceverse.example/oauth/evotor/callback'
const otherRedirect = 'https://spaceverse.example/oauth/other/callback'
const sessionTokenHash = crypto.createHash('sha256').update('oauth-fixture-session').digest('hex')

native('Evotor OAuth state: native PostgreSQL one-time session-bound ownership', () => {
  let setup: pg.Pool, db: pg.Pool, schema = ''
  let ownerId = '', companyId = '', venueId = '', foreignCompanyId = '', foreignVenueId = ''
  beforeAll(async () => {
    setup = new pg.Pool({ connectionString, ssl: false, max: 2 })
    await setup.query('SELECT 1')
    schema = 'evotor_oauth_state_' + crypto.randomBytes(8).toString('hex')
    await setup.query('CREATE SCHEMA ' + schema)
    db = new pg.Pool({ connectionString, ssl: false, max: 16, options: '-c search_path=' + schema })
    await db.query(`CREATE TABLE bars(id BIGINT PRIMARY KEY,code TEXT,name TEXT,address TEXT);
      INSERT INTO bars VALUES(1,'pivnik','Synthetic bar','Fixture');`)
    for (const file of ['001_admin_core.sql', '023_evotor_oauth_states.sql']) {
      const sql = await fs.readFile(new URL('../../admin-migrations/' + file, import.meta.url), 'utf8')
      await db.query(sql)
      if (file.startsWith('023_')) await db.query(sql)
    }
    ownerId = (await db.query<{id:string}>(`INSERT INTO admin_accounts(email,display_name,role,password_hash)
      VALUES('oauth-fixture@invalid.test','Synthetic owner','VENUE_ADMIN','fixture-only')
      RETURNING id::text`)).rows[0]!.id
    companyId = (await db.query<{id:string}>(`SELECT id::text FROM companies WHERE code='pivnik'`)).rows[0]!.id
    venueId = (await db.query<{id:string}>(`SELECT id::text FROM venues WHERE company_id=$1`, [companyId])).rows[0]!.id
    foreignCompanyId = (await db.query<{id:string}>(`INSERT INTO companies(code,name)
      VALUES('foreign-oauth-fixture','Foreign fixture') RETURNING id::text`)).rows[0]!.id
    foreignVenueId = (await db.query<{id:string}>(`INSERT INTO venues(company_id,code,name)
      VALUES($1,'foreign-oauth-venue','Foreign venue') RETURNING id::text`, [foreignCompanyId])).rows[0]!.id
    await db.query(`INSERT INTO admin_company_access(admin_id,company_id,access_kind)
      VALUES($1,$2,'owner')`, [ownerId, companyId])
    await db.query(`INSERT INTO admin_sessions(token_hash,admin_id,expires_at)
      VALUES($1,$2,clock_timestamp()+INTERVAL '1 hour')`, [sessionTokenHash, ownerId])
  }, 30_000)
  afterAll(async () => {
    await db?.end()
    if (setup) {
      if (schema) await setup.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE')
      await setup.end()
    }
  }, 30_000)

  const issue = (overrides: Record<string, string> = {}) =>
    issueEvotorOAuthState({ database: db, spaceverseUserId: ownerId, companyId,
      venueId, sessionTokenHash, productId, redirectUri, ...overrides })
  const consume = (state: string, overrides: Record<string, string> = {}) =>
    consumeEvotorOAuthState({ database: db, state, sessionTokenHash, productId, redirectUri, ...overrides })
  const hash = (state: string) => crypto.createHash('sha256')
    .update(Buffer.from(state, 'base64url')).digest()

  it('issues opaque random state, stores only digest, consumes exact canonical scope once', async () => {
    const { state } = await issue()
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const stored = await db.query<{raw:string,consumed_at:Date|null}>(
      `SELECT encode(state_hash,'hex') AS raw,consumed_at
       FROM admin_evotor_oauth_states WHERE state_hash=$1`, [hash(state)])
    expect(stored.rowCount).toBe(1)
    expect(stored.rows[0]!.raw).toBe(hash(state).toString('hex'))
    expect(stored.rows[0]!.raw).not.toContain(state)
    expect(stored.rows[0]!.consumed_at).toBeNull()
    const scope = await consume(state)
    expect(scope).toEqual({ spaceverseUserId: ownerId, companyId, venueId,
      productId, sessionId: sessionTokenHash, redirectUri })
    expect(Object.isFrozen(scope)).toBe(true)
    await expect(consume(state)).rejects.toMatchObject({code:'EVOTOR_OAUTH_STATE_DENIED',statusCode:403})
  })

  it('allows exactly one of twelve concurrent callbacks on native pool connections', async () => {
    const { state } = await issue()
    const results = await Promise.allSettled(Array.from({length:12}, () => consume(state)))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(11)
    const rows = await db.query(`SELECT consumed_at FROM admin_evotor_oauth_states WHERE state_hash=$1`, [hash(state)])
    expect(rows.rows[0]?.consumed_at).toBeTruthy()
  })

  it('rejects foreign session, product and callback URI without burning legitimate state', async () => {
    const { state } = await issue()
    const foreignSession = crypto.createHash('sha256').update('foreign').digest('hex')
    await expect(consume(state, {sessionTokenHash: foreignSession}))
      .rejects.toMatchObject({code:'EVOTOR_OAUTH_STATE_DENIED'})
    await expect(consume(state, {productId:otherProductId}))
      .rejects.toMatchObject({code:'EVOTOR_OAUTH_STATE_DENIED'})
    await expect(consume(state, {redirectUri:otherRedirect}))
      .rejects.toMatchObject({code:'EVOTOR_OAUTH_STATE_DENIED'})
    expect((await consume(state)).companyId).toBe(companyId)
  })

  it('denies foreign company/venue and trusted manager at issuance', async () => {
    await expect(issue({companyId:foreignCompanyId,venueId:foreignVenueId}))
      .rejects.toMatchObject({code:'EVOTOR_OAUTH_STATE_DENIED'})
    await expect(issue({venueId:foreignVenueId}))
      .rejects.toMatchObject({code:'EVOTOR_OAUTH_STATE_DENIED'})
    await db.query(`UPDATE admin_company_access SET access_kind='trusted' WHERE admin_id=$1`, [ownerId])
    try { await expect(issue()).rejects.toMatchObject({code:'EVOTOR_OAUTH_STATE_DENIED'}) }
    finally { await db.query(`UPDATE admin_company_access SET access_kind='owner' WHERE admin_id=$1`, [ownerId]) }
  })

  it('rechecks revoked owner grant and disabled venue at consumption; rolls back the claim', async () => {
    const { state } = await issue()
    await db.query(`DELETE FROM admin_company_access WHERE admin_id=$1`, [ownerId])
    try { await expect(consume(state)).rejects.toMatchObject({code:'EVOTOR_OAUTH_STATE_DENIED'}) }
    finally { await db.query(`INSERT INTO admin_company_access(admin_id,company_id,access_kind)
      VALUES($1,$2,'owner')`, [ownerId,companyId]) }
    await db.query(`UPDATE venues SET active=FALSE WHERE id=$1`, [venueId])
    try { await expect(consume(state)).rejects.toMatchObject({code:'EVOTOR_OAUTH_STATE_DENIED'}) }
    finally { await db.query(`UPDATE venues SET active=TRUE WHERE id=$1`, [venueId]) }
    expect((await consume(state)).venueId).toBe(venueId)
  })

  it('denies expired or deleted sessions and inactive accounts on both paths', async () => {
    const { state } = await issue()
    await db.query(`UPDATE admin_sessions SET expires_at=clock_timestamp()-INTERVAL '1 minute'
      WHERE token_hash=$1`, [sessionTokenHash])
    try {
      await expect(issue()).rejects.toMatchObject({code:'EVOTOR_OAUTH_STATE_DENIED'})
      await expect(consume(state)).rejects.toMatchObject({code:'EVOTOR_OAUTH_STATE_DENIED'})
    } finally {
      await db.query(`UPDATE admin_sessions SET expires_at=clock_timestamp()+INTERVAL '1 hour'
        WHERE token_hash=$1`, [sessionTokenHash])
    }
    await db.query('UPDATE admin_accounts SET active=FALSE WHERE id=$1', [ownerId])
    try {
      await expect(issue()).rejects.toMatchObject({code:'EVOTOR_OAUTH_STATE_DENIED'})
      await expect(consume(state)).rejects.toMatchObject({code:'EVOTOR_OAUTH_STATE_DENIED'})
    } finally { await db.query('UPDATE admin_accounts SET active=TRUE WHERE id=$1', [ownerId]) }
    expect((await consume(state)).spaceverseUserId).toBe(ownerId)
  })

  it('denies expired state and malformed context without consuming another state', async () => {
    const { state } = await issue()
    await db.query(`UPDATE admin_evotor_oauth_states SET issued_at=clock_timestamp()-INTERVAL '10 minutes',
        expires_at=clock_timestamp()-INTERVAL '1 minute'
      WHERE state_hash=$1`, [hash(state)])
    await expect(consume(state)).rejects.toMatchObject({code:'EVOTOR_OAUTH_STATE_DENIED'})
    const fresh = (await issue()).state
    for (const malformed of ['', 'x', fresh + '=', fresh.slice(0,-1) + '!']) {
      await expect(consume(malformed)).rejects.toMatchObject({code:'EVOTOR_OAUTH_STATE_DENIED'})
    }
    await expect(issue({redirectUri:'http://spaceverse.example/oauth/callback'}))
      .rejects.toMatchObject({code:'EVOTOR_OAUTH_STATE_DENIED'})
    await expect(issue({spaceverseUserId:'0'}))
      .rejects.toMatchObject({code:'EVOTOR_OAUTH_STATE_DENIED'})
    expect((await consume(fresh)).venueId).toBe(venueId)
  })

  it('fails closed with unavailable table, without exposing database details', async () => {
    const broken = new pg.Pool({connectionString,ssl:false,max:2,
      options:'-c search_path=missing_evotor_oauth_schema'})
    try {
      await expect(issueEvotorOAuthState({database:broken,spaceverseUserId:ownerId,
        companyId,venueId,sessionTokenHash,productId,redirectUri}))
        .rejects.toMatchObject({code:'EVOTOR_OAUTH_STATE_UNAVAILABLE',statusCode:503})
      const {state} = await issue()
      await expect(consumeEvotorOAuthState({database:broken,state,sessionTokenHash,productId,redirectUri}))
        .rejects.toMatchObject({code:'EVOTOR_OAUTH_STATE_UNAVAILABLE',statusCode:503})
    } finally { await broken.end() }
  })
})
