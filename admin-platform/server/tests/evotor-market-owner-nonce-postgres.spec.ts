// @vitest-environment node
// Requires an explicitly disposable native PostgreSQL database.
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEvotorOwnerNonceConsumer } from '../evotor-market-owner-nonce.js'
import { verifyEvotorOwnerProofOnce } from '../evotor-market-owner-proof.js'

const connectionString = String(process.env.ADMIN_INTEGRATION_TEST_DATABASE_URL || '')
const disposable = (() => {
  try { return /^codex_admin_test(?:_|$)/.test(decodeURIComponent(new URL(connectionString).pathname.slice(1))) }
  catch { return false }
})()
const native = connectionString && disposable ? describe : describe.skip

native('Evotor owner proof nonce: native PostgreSQL atomic replay denial', () => {
  let setup: pg.Pool
  let db: pg.Pool
  let schema = ''
  beforeAll(async () => {
    setup = new pg.Pool({ connectionString, ssl: false, max: 2 })
    await setup.query('SELECT 1')
    schema = 'evotor_owner_nonce_' + crypto.randomBytes(8).toString('hex')
    await setup.query('CREATE SCHEMA ' + schema)
    db = new pg.Pool({ connectionString, ssl: false, max: 12, options: '-c search_path=' + schema })
    const sql = await fs.readFile(new URL('../../admin-migrations/022_evotor_owner_proof_nonces.sql', import.meta.url), 'utf8')
    await db.query(sql)
    await db.query(sql)
  }, 30_000)
  afterAll(async () => {
    await db?.end()
    if (setup) {
      if (schema) await setup.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE')
      await setup.end()
    }
  }, 30_000)

  it('permits exactly one of 12 concurrent claims across native pool connections', async () => {
    const consume = createEvotorOwnerNonceConsumer(db, 'test-key-1')
    const nonce = crypto.randomBytes(32).toString('base64url')
    const results = await Promise.all(Array.from({ length: 12 }, () => consume(nonce, Date.now() + 60_000)))
    expect(results.filter(Boolean)).toHaveLength(1)
    const stored = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM admin_evotor_owner_proof_nonces')
    expect(stored.rows[0]?.count).toBe('1')
  })
  it('rejects replay after a new consumer instance and accepts a new nonce', async () => {
    const nonce = crypto.randomBytes(32).toString('base64url')
    expect(await createEvotorOwnerNonceConsumer(db, 'test-key-1')(nonce, Date.now() + 60_000)).toBe(true)
    expect(await createEvotorOwnerNonceConsumer(db, 'test-key-1')(nonce, Date.now() + 60_000)).toBe(false)
    expect(await createEvotorOwnerNonceConsumer(db, 'test-key-1')(crypto.randomBytes(32).toString('base64url'), Date.now() + 60_000)).toBe(true)
  })
  it('accepts one signed proof and denies native PostgreSQL replay', async () => {
    const signingKey = Buffer.alloc(32, 17)
    const scope = {
      spaceverseUserId: 'owner-1', sessionId: 'session-1', providerUserId: 'provider-1',
      productId: 'c0d01535-5193-4cc2-9bfb-be20e0679498', companyId: 'company-1', venueId: 'venue-1',
      storeId: 'store-1', tokenRevision: '1',
    }
    const now = Date.now()
    const payload = {
      purpose: 'spaceverse.evotor.store-owner-binding.v1',
      nonce: crypto.randomBytes(32).toString('base64url'), ...scope,
      issuedAt: now - 1_000, expiresAt: now + 60_000,
    }
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const mac = crypto.createHmac('sha256', signingKey)
      .update('spaceverse.evotor.store-owner-binding.v1\n' + encoded).digest('base64url')
    const proof = encoded + '.' + mac
    const consumeNonce = createEvotorOwnerNonceConsumer(db, 'test-key-1')
    const verify = () => verifyEvotorOwnerProofOnce({ proof, signingKey, expected: scope, consumeNonce, now })
    expect((await verify()).storeId).toBe(scope.storeId)
    await expect(verify()).rejects.toMatchObject({ code: 'EVOTOR_OWNER_PROOF_INVALID' })
  })
  it('fails closed for expired proof, invalid nonce, and unavailable table', async () => {
    const consume = createEvotorOwnerNonceConsumer(db, 'test-key-1')
    expect(await consume(crypto.randomBytes(32).toString('base64url'), Date.now() - 1_000)).toBe(false)
    await expect(consume('short', Date.now() + 60_000)).rejects.toMatchObject({ code: 'EVOTOR_OWNER_NONCE_UNAVAILABLE' })
    const broken = new pg.Pool({ connectionString, ssl: false, max: 2,
      options: '-c search_path=nonexistent_owner_nonce_schema' })
    try {
      await expect(createEvotorOwnerNonceConsumer(broken, 'test-key-1')(
        crypto.randomBytes(32).toString('base64url'), Date.now() + 60_000,
      )).rejects.toMatchObject({ code: 'EVOTOR_OWNER_NONCE_UNAVAILABLE' })
    } finally { await broken.end() }
  })
})
