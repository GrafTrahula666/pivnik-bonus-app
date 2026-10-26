// @vitest-environment node
// Disposable native PostgreSQL ONLY. No provider account or production binding.
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import pg from 'pg'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { withEvotorOwnerBindingGuard } from '../evotor-market-binding-guard.js'
import { createEvotorOwnerNonceConsumer } from '../evotor-market-owner-nonce.js'

const connectionString = String(process.env.ADMIN_INTEGRATION_TEST_DATABASE_URL || '')
const disposable = (() => {
  try { return /^codex_admin_test(?:_|$)/.test(decodeURIComponent(new URL(connectionString).pathname.slice(1))) }
  catch { return false }
})()
const native = connectionString && disposable ? describe : describe.skip
const productId = 'c0d01535-5193-4cc2-9bfb-be20e0679498'
const providerUserId = 'fixture-owner-provider-1'
const storeId = '20170228-F4F1-401B-80FA-9ECCA8451FFB'
const sessionTokenHash = crypto.createHash('sha256').update('fixture-session-only').digest('hex')
const key = Buffer.alloc(32, 17)
const token = 'fixture-only-cloud-token'
const fetchStores: typeof fetch = async () => Response.json({
  items: [{ id: storeId, user_id: providerUserId }], paging: {},
})

native('Evotor binding guard: native canonical locks, provider revision and owner denial', () => {
  let setup: pg.Pool, db: pg.Pool, schema = '', ownerId = '', companyId = '', venueId = ''
  beforeAll(async () => {
    setup = new pg.Pool({ connectionString, ssl: false, max: 2 })
    await setup.query('SELECT 1')
    schema = 'evotor_binding_' + crypto.randomBytes(8).toString('hex')
    await setup.query('CREATE SCHEMA ' + schema)
    db = new pg.Pool({ connectionString, ssl: false, max: 10, options: '-c search_path=' + schema })
    await db.query(`CREATE TABLE bars(id BIGINT PRIMARY KEY,code TEXT,name TEXT,address TEXT);
      INSERT INTO bars VALUES(1,'pivnik','Synthetic bar','Fixture');`)
    for (const file of [
      '001_admin_core.sql', '020_evotor_market_inbox.sql',
      '021_evotor_market_reconciliation.sql', '022_evotor_owner_proof_nonces.sql',
    ]) await db.query(await fs.readFile(new URL('../../admin-migrations/' + file, import.meta.url), 'utf8'))
    const owner = await db.query<{id:string}>(`INSERT INTO admin_accounts(email,display_name,role,password_hash)
      VALUES('fixture-owner@invalid.test','Synthetic owner','VENUE_ADMIN','fixture-only')
      RETURNING id::text`)
    ownerId = owner.rows[0]!.id
    companyId = (await db.query<{id:string}>("SELECT id::text FROM companies WHERE code='pivnik'")).rows[0]!.id
    venueId = (await db.query<{id:string}>('SELECT id::text FROM venues WHERE company_id=$1', [companyId])).rows[0]!.id
    await db.query('INSERT INTO admin_company_access(admin_id,company_id,access_kind) VALUES($1,$2,\'owner\')',
      [ownerId, companyId])
    await db.query(`INSERT INTO admin_sessions(token_hash,admin_id,expires_at)
      VALUES($1,$2,NOW()+INTERVAL '1 hour')`, [sessionTokenHash, ownerId])
    await db.query(`INSERT INTO admin_evotor_market_users(
      product_id,user_id,secret_key_id,secret_nonce,secret_ciphertext,secret_auth_tag,
      token_fingerprint,token_revision,installation_state,reconciliation_required
    ) VALUES($1,$2,'fixture',$3,$4,$5,'fixture-fingerprint',1,'installed',FALSE)`,
    [productId, providerUserId, Buffer.alloc(12,1), Buffer.alloc(24,2), Buffer.alloc(16,3)])
    await db.query('CREATE TABLE test_bindings(id BIGSERIAL PRIMARY KEY,store_id TEXT NOT NULL)')
  }, 30_000)
  afterAll(async () => {
    await db?.end()
    if (setup) {
      if (schema) await setup.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE')
      await setup.end()
    }
  }, 30_000)

  const scope = (overrides: Record<string,string> = {}) => ({
    spaceverseUserId: ownerId, sessionId: sessionTokenHash, providerUserId,
    productId, companyId, venueId, storeId, tokenRevision: '1', ...overrides,
  })
  const proofFor = (expected: ReturnType<typeof scope>) => {
    const now = Date.now()
    const payload = {
      purpose: 'spaceverse.evotor.store-owner-binding.v1',
      nonce: crypto.randomBytes(32).toString('base64url'),
      ...expected, issuedAt: now - 1000, expiresAt: now + 60_000,
    }
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const mac = crypto.createHmac('sha256', key)
      .update('spaceverse.evotor.store-owner-binding.v1\n' + encoded).digest('base64url')
    return encoded + '.' + mac
  }
  const guard = (overrides: Record<string,string> = {}, options: {
    fetchImpl?: typeof fetch
    onVerified?: (client: pg.PoolClient) => Promise<string>
  } = {}) => {
    const expected = scope(overrides)
    return withEvotorOwnerBindingGuard({
      database: db, proof: proofFor(expected), signingKey: key, expected,
      sessionTokenHash, providerToken: token,
      consumeNonce: createEvotorOwnerNonceConsumer(db, 'fixture-key'),
      fetchImpl: options.fetchImpl || fetchStores,
      onVerified: options.onVerified || (async client => {
        await client.query('INSERT INTO test_bindings(store_id) VALUES($1)', [storeId])
        return 'bound'
      }),
    })
  }
  const count = async () => (await db.query<{n:string}>('SELECT count(*)::text AS n FROM test_bindings')).rows[0]!.n

  it('commits one guarded write with exact provider store, canonical owner, session and venue', async () => {
    expect(await guard()).toBe('bound')
    expect(await count()).toBe('1')
  })
  it('denies a foreign canonical venue and foreign company, even for a valid signature', async () => {
    const before = await count()
    await expect(guard({ venueId: '999999' })).rejects.toMatchObject({code:'EVOTOR_BINDING_DENIED'})
    await expect(guard({ companyId: '999999' })).rejects.toMatchObject({code:'EVOTOR_BINDING_DENIED'})
    expect(await count()).toBe(before)
  })
  it('denies a store missing from complete provider evidence', async () => {
    const before = await count()
    await expect(guard({ storeId: 'unowned-store' })).rejects.toMatchObject({code:'EVOTOR_BINDING_DENIED'})
    expect(await count()).toBe(before)
  })
  it('denies revoked owner grant and trusted director without granting platform bypass', async () => {
    const before = await count()
    await db.query("UPDATE admin_company_access SET access_kind='trusted' WHERE admin_id=$1", [ownerId])
    try { await expect(guard()).rejects.toMatchObject({code:'EVOTOR_BINDING_DENIED'}) }
    finally { await db.query("UPDATE admin_company_access SET access_kind='owner' WHERE admin_id=$1", [ownerId]) }
    expect(await count()).toBe(before)
  })
  it('denies expired session and inactive account', async () => {
    const before = await count()
    await db.query("UPDATE admin_sessions SET expires_at=NOW()-INTERVAL '1 minute' WHERE token_hash=$1", [sessionTokenHash])
    try { await expect(guard()).rejects.toMatchObject({code:'EVOTOR_BINDING_DENIED'}) }
    finally { await db.query("UPDATE admin_sessions SET expires_at=NOW()+INTERVAL '1 hour' WHERE token_hash=$1", [sessionTokenHash]) }
    await db.query('UPDATE admin_accounts SET active=FALSE WHERE id=$1', [ownerId])
    try { await expect(guard()).rejects.toMatchObject({code:'EVOTOR_BINDING_DENIED'}) }
    finally { await db.query('UPDATE admin_accounts SET active=TRUE WHERE id=$1', [ownerId]) }
    expect(await count()).toBe(before)
  })
  it('rejects token rotation during provider GET before opening a binding transaction', async () => {
    const before = await count()
    const rotatingFetch: typeof fetch = async () => {
      await db.query('UPDATE admin_evotor_market_users SET token_revision=2 WHERE product_id=$1', [productId])
      return fetchStores('https://api.evotor.ru/stores')
    }
    try { await expect(guard({}, {fetchImpl:rotatingFetch})).rejects.toMatchObject({code:'EVOTOR_BINDING_UNAVAILABLE'}) }
    finally { await db.query('UPDATE admin_evotor_market_users SET token_revision=1 WHERE product_id=$1', [productId]) }
    expect(await count()).toBe(before)
  })
  it('denies uninstalled or reconciliation-held provider identity before any GET', async () => {
    const before = await count()
    let calls = 0
    const countedFetch: typeof fetch = async () => { calls++; return fetchStores('https://api.evotor.ru/stores') }
    await db.query("UPDATE admin_evotor_market_users SET installation_state='uninstalled' WHERE product_id=$1", [productId])
    try { await expect(guard({}, {fetchImpl:countedFetch})).rejects.toMatchObject({code:'EVOTOR_BINDING_UNAVAILABLE'}) }
    finally { await db.query("UPDATE admin_evotor_market_users SET installation_state='installed' WHERE product_id=$1", [productId]) }
    await db.query('UPDATE admin_evotor_market_users SET reconciliation_required=TRUE WHERE product_id=$1', [productId])
    try { await expect(guard({}, {fetchImpl:countedFetch})).rejects.toMatchObject({code:'EVOTOR_BINDING_UNAVAILABLE'}) }
    finally { await db.query('UPDATE admin_evotor_market_users SET reconciliation_required=FALSE WHERE product_id=$1', [productId]) }
    expect(calls).toBe(0)
    expect(await count()).toBe(before)
  })
  it('rolls back an authorized binding callback failure', async () => {
    const before = await count()
    await expect(guard({}, {onVerified:async client => {
      await client.query('INSERT INTO test_bindings(store_id) VALUES($1)', [storeId])
      throw new Error('synthetic write failure')
    }})).rejects.toMatchObject({code:'EVOTOR_BINDING_UNAVAILABLE'})
    expect(await count()).toBe(before)
  })
  it('holds native provider revision lock until binding COMMIT, then allows revoke', async () => {
    let release!: () => void
    let entered!: () => void
    const inside = new Promise<void>(resolve => { entered = resolve })
    const barrier = new Promise<void>(resolve => { release = resolve })
    const binding = guard({}, {onVerified:async client => {
      entered()
      await barrier
      await client.query('INSERT INTO test_bindings(store_id) VALUES($1)', [storeId])
      return 'bound'
    }})
    await inside
    let updated = false
    const revoke = db.query('UPDATE admin_evotor_market_users SET token_revision=2 WHERE product_id=$1', [productId])
      .then(() => { updated = true })
    try {
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(updated).toBe(false)
    } finally { release() }
    expect(await binding).toBe('bound')
    await revoke
    expect(updated).toBe(true)
    await db.query('UPDATE admin_evotor_market_users SET token_revision=1 WHERE product_id=$1', [productId])
  })
})
