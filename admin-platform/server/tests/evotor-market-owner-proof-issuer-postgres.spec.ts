// @vitest-environment node
// Disposable native PostgreSQL 16; synthetic OAuth and stores, no live provider.
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import pg from 'pg'
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { issueEvotorOAuthState } from '../evotor-market-oauth-state.js'
import { issueEvotorOwnerProofFromOAuth } from '../evotor-market-owner-proof-issuer.js'
import { verifyEvotorOwnerProofOnce } from '../evotor-market-owner-proof.js'
import { createEvotorOwnerNonceConsumer } from '../evotor-market-owner-nonce.js'

const connectionString = String(process.env.ADMIN_INTEGRATION_TEST_DATABASE_URL || '')
const disposable = (() => {
  try { return /^codex_admin_test(?:_|$)/.test(decodeURIComponent(new URL(connectionString).pathname.slice(1))) }
  catch { return false }
})()
const native = connectionString && disposable ? describe : describe.skip
const productId = 'c0d01535-5193-4cc2-9bfb-be20e0679498'
const providerUserId = 'fixture-provider-user-1'
const storeId = '20170228-F4F1-401B-80FA-9ECCA8451FFB'
const redirectUri = 'https://spaceverse.example/oauth/evotor/callback'
const sessionTokenHash = crypto.createHash('sha256').update('issuer-fixture-session').digest('hex')
const key = Buffer.alloc(32, 41)
const accessToken = 'synthetic-oauth-token-do-not-use'

const oauthResponse = () => Response.json({
  access_token: accessToken, token_type: 'Bearer', expires_in: 3600, scope: 'store:read',
})
const storesResponse = (userId = providerUserId, selectedId = storeId) =>
  Response.json({ items: [{ id: selectedId, user_id: userId }], paging: {} })
const fetchProvider = (storeUserId = providerUserId): typeof fetch => vi.fn<typeof fetch>()
  .mockImplementation(async (input) => {
    if (String(input) === 'https://oauth.evotor.ru/oauth/token') return oauthResponse()
    if (String(input).startsWith('https://api.evotor.ru/stores')) return storesResponse(storeUserId)
    throw Error('unexpected host')
  })

native('Evotor trusted OAuth owner proof issuer: native PostgreSQL and negative scope', () => {
  let setup: pg.Pool, db: pg.Pool, schema = ''
  let ownerId = '', companyId = '', venueId = '', foreignCompanyId = ''
  beforeAll(async () => {
    setup = new pg.Pool({ connectionString, ssl: false, max: 2 })
    await setup.query('SELECT 1')
    schema = 'evotor_issuer_' + crypto.randomBytes(8).toString('hex')
    await setup.query('CREATE SCHEMA ' + schema)
    db = new pg.Pool({ connectionString, ssl: false, max: 14, options: '-c search_path=' + schema })
    await db.query("CREATE TABLE bars(id BIGINT PRIMARY KEY,code TEXT,name TEXT,address TEXT); INSERT INTO bars VALUES(1,'pivnik','Synthetic bar','Fixture');")
    for (const file of [
      '001_admin_core.sql', '020_evotor_market_inbox.sql',
      '021_evotor_market_reconciliation.sql', '022_evotor_owner_proof_nonces.sql',
      '023_evotor_oauth_states.sql',
    ]) await db.query(await fs.readFile(new URL('../../admin-migrations/' + file, import.meta.url), 'utf8'))
    ownerId = (await db.query<{id:string}>(
      "INSERT INTO admin_accounts(email,display_name,role,password_hash) VALUES('issuer@invalid.test','Fixture','VENUE_ADMIN','fixture') RETURNING id::text",
    )).rows[0]!.id
    companyId = (await db.query<{id:string}>("SELECT id::text FROM companies WHERE code='pivnik'")).rows[0]!.id
    venueId = (await db.query<{id:string}>('SELECT id::text FROM venues WHERE company_id=$1', [companyId])).rows[0]!.id
    foreignCompanyId = (await db.query<{id:string}>(
      "INSERT INTO companies(code,name) VALUES('issuer-foreign','Foreign fixture') RETURNING id::text",
    )).rows[0]!.id
    await db.query("INSERT INTO admin_company_access(admin_id,company_id,access_kind) VALUES($1,$2,'owner')", [ownerId,companyId])
    await db.query("INSERT INTO admin_sessions(token_hash,admin_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '1 hour')", [sessionTokenHash,ownerId])
    await db.query(
      [
        'INSERT INTO admin_evotor_market_users(product_id,user_id,secret_key_id,secret_nonce,',
        'secret_ciphertext,secret_auth_tag,token_fingerprint,token_revision,installation_state,reconciliation_required)',
        "VALUES($1,$2,'fixture',$3,$4,$5,'synthetic',1,'installed',FALSE)",
      ].join(' '),
      [productId,providerUserId,Buffer.alloc(12,1),Buffer.alloc(24,2),Buffer.alloc(16,3)],
    )
  }, 30_000)
  afterAll(async () => {
    await db?.end()
    if (setup) {
      if (schema) await setup.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE')
      await setup.end()
    }
  }, 30_000)

  const state = async () => (await issueEvotorOAuthState({
    database: db, spaceverseUserId: ownerId, companyId, venueId,
    sessionTokenHash, productId, redirectUri,
  })).state
  const issue = (s: string, overrides: Record<string,unknown> = {}) =>
    issueEvotorOwnerProofFromOAuth({
      database: db, state: s, sessionTokenHash, productId, redirectUri,
      code: 'synthetic-code', clientId: 'fixture-client', clientSecret: 'fixture-secret',
      expectedProviderUserId: providerUserId, selectedStoreId: storeId,
      signingKey: key, fetchImpl: fetchProvider(), ...overrides,
    })
  const expected = (revision = '1') => ({
    spaceverseUserId: ownerId, sessionId: sessionTokenHash, providerUserId,
    productId, companyId, venueId, storeId, tokenRevision: revision,
  })

  it('issues a short-lived proof only after state, OAuth, complete stores and canonical grants; consumes nonce once', async () => {
    const s = await state()
    const fetchImpl = fetchProvider()
    const result = await issue(s, {fetchImpl})
    expect(result.proof).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(result.proof).not.toContain(accessToken)
    expect(Object.isFrozen(result)).toBe(true)
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(2)
    const claim = await verifyEvotorOwnerProofOnce({
      proof: result.proof, signingKey: key, expected: expected(),
      consumeNonce: createEvotorOwnerNonceConsumer(db,'fixture-key'),
    })
    expect(claim.storeId).toBe(storeId)
    await expect(verifyEvotorOwnerProofOnce({
      proof: result.proof, signingKey: key, expected: expected(),
      consumeNonce: createEvotorOwnerNonceConsumer(db,'fixture-key'),
    })).rejects.toMatchObject({code:'EVOTOR_OWNER_PROOF_INVALID'})
    await expect(issue(s)).rejects.toMatchObject({code:'EVOTOR_OWNER_ISSUE_DENIED'})
  })

  it('denies foreign session before provider calls without burning rightful state', async () => {
    const s = await state(), fetchImpl = fetchProvider()
    await expect(issue(s, {
      sessionTokenHash: crypto.createHash('sha256').update('foreign').digest('hex'), fetchImpl,
    })).rejects.toMatchObject({code:'EVOTOR_OWNER_ISSUE_DENIED'})
    expect(vi.mocked(fetchImpl)).not.toHaveBeenCalled()
    expect((await issue(s)).proof).toBeTruthy()
  })

  it('denies selected foreign store, even when OAuth and installed provider identity match', async () => {
    const s = await state()
    await expect(issue(s, {selectedStoreId:'attacker-store'}))
      .rejects.toMatchObject({code:'EVOTOR_OWNER_ISSUE_DENIED'})
    await expect(issue(s)).rejects.toMatchObject({code:'EVOTOR_OWNER_ISSUE_DENIED'})
  })

  it('rejects a foreign OAuth provider identity, not just a browser user ID', async () => {
    const s = await state()
    await expect(issue(s, {fetchImpl:fetchProvider('other-provider-user')}))
      .rejects.toMatchObject({code:'EVOTOR_OWNER_ISSUE_UNAVAILABLE'})
  })

  it('denies revoked owner grant before any OAuth network call', async () => {
    const s = await state(), fetchImpl = fetchProvider()
    await db.query("UPDATE admin_company_access SET access_kind='trusted' WHERE admin_id=$1", [ownerId])
    try {
      await expect(issue(s,{fetchImpl})).rejects.toMatchObject({code:'EVOTOR_OWNER_ISSUE_DENIED'})
      expect(vi.mocked(fetchImpl)).not.toHaveBeenCalled()
    } finally {
      await db.query("UPDATE admin_company_access SET access_kind='owner' WHERE admin_id=$1", [ownerId])
    }
  })

  it('denies reconciliation hold and token revoke before provider stores', async () => {
    const s = await state(), fetchImpl = fetchProvider()
    await db.query('UPDATE admin_evotor_market_users SET reconciliation_required=TRUE WHERE product_id=$1', [productId])
    try {
      await expect(issue(s,{fetchImpl})).rejects.toMatchObject({code:'EVOTOR_OWNER_ISSUE_DENIED'})
      expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(1)
    } finally {
      await db.query('UPDATE admin_evotor_market_users SET reconciliation_required=FALSE WHERE product_id=$1', [productId])
    }
    const next = await state(), second = fetchProvider()
    await db.query("UPDATE admin_evotor_market_users SET installation_state='uninstalled' WHERE product_id=$1", [productId])
    try {
      await expect(issue(next,{fetchImpl:second})).rejects.toMatchObject({code:'EVOTOR_OWNER_ISSUE_DENIED'})
      expect(vi.mocked(second)).toHaveBeenCalledTimes(1)
    } finally {
      await db.query("UPDATE admin_evotor_market_users SET installation_state='installed' WHERE product_id=$1", [productId])
    }
  })

  it('denies a token revision rotated during the provider GET and never signs stale evidence', async () => {
    const s = await state()
    const fetchImpl: typeof fetch = vi.fn<typeof fetch>().mockImplementation(async input => {
      if (String(input).includes('oauth/token')) return oauthResponse()
      await db.query('UPDATE admin_evotor_market_users SET token_revision=token_revision+1 WHERE product_id=$1', [productId])
      return storesResponse()
    })
    await expect(issue(s,{fetchImpl})).rejects.toMatchObject({code:'EVOTOR_OWNER_ISSUE_UNAVAILABLE'})
    await db.query('UPDATE admin_evotor_market_users SET token_revision=1 WHERE product_id=$1', [productId])
  })

  it('permits only one of concurrent callbacks for a single state', async () => {
    const s = await state()
    const results = await Promise.allSettled(Array.from({length:8}, () => issue(s)))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(7)
  })

  it('denies invalid signing key before consuming a state and keeps tenant scope canonical', async () => {
    const s = await state()
    await expect(issue(s,{signingKey:Buffer.alloc(12)}))
      .rejects.toMatchObject({code:'EVOTOR_OWNER_ISSUE_DENIED'})
    const result = await issue(s)
    await expect(verifyEvotorOwnerProofOnce({
      proof:result.proof, signingKey:key,
      expected:{...expected(),companyId:foreignCompanyId},
      consumeNonce:async()=>true,
    })).rejects.toMatchObject({code:'EVOTOR_OWNER_PROOF_INVALID'})
  })
})
