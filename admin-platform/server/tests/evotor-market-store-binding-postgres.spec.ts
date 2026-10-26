// @vitest-environment node
// Disposable native PostgreSQL ONLY; synthetic provider and owner identities.
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import pg from 'pg'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { bindEvotorStoreWithOwnerProof, readEvotorStoreBindingStatus } from '../evotor-market-store-binding.js'
import { createEvotorOwnerNonceConsumer } from '../evotor-market-owner-nonce.js'

const connectionString = String(process.env.ADMIN_INTEGRATION_TEST_DATABASE_URL || '')
const disposable = (() => {
  try { return /^codex_admin_test(?:_|$)/.test(decodeURIComponent(new URL(connectionString).pathname.slice(1))) }
  catch { return false }
})()
const native = connectionString && disposable ? describe : describe.skip
const productId = 'c0d01535-5193-4cc2-9bfb-be20e0679498'
const providerUserId = 'fixture-provider-binding'
const sessionA = crypto.createHash('sha256').update('store-binding-A').digest('hex')
const sessionB = crypto.createHash('sha256').update('store-binding-B').digest('hex')
const key = Buffer.alloc(32, 72)
const storeA = 'fixture-store-a', storeB = 'fixture-store-b', storeC = 'fixture-store-c'

native('Evotor durable binding persistence / native PostgreSQL', () => {
  let setup: pg.Pool, db: pg.Pool, schema = ''
  let ownerA = '', ownerB = '', companyA = '', companyB = '', venueA = '', venueB = ''
  beforeAll(async () => {
    setup = new pg.Pool({ connectionString, ssl: false, max: 2 })
    await setup.query('SELECT 1')
    schema = 'evotor_bind_persist_' + crypto.randomBytes(8).toString('hex')
    await setup.query('CREATE SCHEMA ' + schema)
    db = new pg.Pool({ connectionString, ssl: false, max: 14, options: '-c search_path=' + schema })
    await db.query("CREATE TABLE bars(id BIGINT PRIMARY KEY,code TEXT,name TEXT,address TEXT); INSERT INTO bars VALUES(1,'pivnik','Fixture bar','Fixture');")
    for (const file of [
      '001_admin_core.sql', '020_evotor_market_inbox.sql',
      '021_evotor_market_reconciliation.sql', '022_evotor_owner_proof_nonces.sql',
      '024_evotor_store_bindings.sql',
    ]) await db.query(await fs.readFile(new URL('../../admin-migrations/' + file, import.meta.url), 'utf8'))
    const account = async (email: string) => (await db.query<{id:string}>(
      "INSERT INTO admin_accounts(email,display_name,role,password_hash) VALUES($1,'Fixture owner','VENUE_ADMIN','fixture') RETURNING id::text",
      [email],
    )).rows[0]!.id
    ownerA = await account('bind-a@invalid.test')
    ownerB = await account('bind-b@invalid.test')
    companyA = (await db.query<{id:string}>("SELECT id::text FROM companies WHERE code='pivnik'")).rows[0]!.id
    venueA = (await db.query<{id:string}>('SELECT id::text FROM venues WHERE company_id=$1', [companyA])).rows[0]!.id
    companyB = (await db.query<{id:string}>("INSERT INTO companies(code,name) VALUES('bind-foreign','Foreign fixture') RETURNING id::text")).rows[0]!.id
    venueB = (await db.query<{id:string}>("INSERT INTO venues(company_id,code,name) VALUES($1,'bind-foreign-1','Foreign venue') RETURNING id::text", [companyB])).rows[0]!.id
    await db.query("INSERT INTO admin_company_access(admin_id,company_id,access_kind) VALUES($1,$2,'owner'),($3,$4,'owner')", [ownerA,companyA,ownerB,companyB])
    await db.query("INSERT INTO admin_sessions(token_hash,admin_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '1 hour'),($3,$4,NOW()+INTERVAL '1 hour')", [sessionA,ownerA,sessionB,ownerB])
    await db.query(`INSERT INTO admin_evotor_market_users
      (product_id,user_id,secret_key_id,secret_nonce,secret_ciphertext,secret_auth_tag,
       token_fingerprint,token_revision,installation_state,reconciliation_required)
      VALUES($1,$2,'fixture',$3,$4,$5,'fixture-fingerprint',1,'installed',FALSE)`,
      [productId,providerUserId,Buffer.alloc(12,1),Buffer.alloc(24,2),Buffer.alloc(16,3)])
  }, 30_000)
  afterAll(async () => {
    await db?.end()
    if (setup) {
      if (schema) await setup.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE')
      await setup.end()
    }
  }, 30_000)

  const scope = (storeId: string, foreign = false, revision = '1') => ({
    spaceverseUserId: foreign ? ownerB : ownerA,
    sessionId: foreign ? sessionB : sessionA, providerUserId, productId,
    companyId: foreign ? companyB : companyA, venueId: foreign ? venueB : venueA,
    storeId, tokenRevision: revision,
  })
  const proof = (expected: ReturnType<typeof scope>) => {
    const now = Date.now()
    const payload = {
      purpose: 'spaceverse.evotor.store-owner-binding.v1',
      nonce: crypto.randomBytes(32).toString('base64url'),
      ...expected, issuedAt: now - 1000, expiresAt: now + 60_000,
    }
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const mac = crypto.createHmac('sha256',key)
      .update('spaceverse.evotor.store-owner-binding.v1\n'+encoded).digest('base64url')
    return encoded + '.' + mac
  }
  const bind = (storeId: string, foreign = false, revision = '1') => {
    const expected = scope(storeId, foreign, revision)
    const fetchImpl: typeof fetch = async () => Response.json({
      items: [{id:storeId,user_id:providerUserId}], paging: {},
    })
    return bindEvotorStoreWithOwnerProof({
      database:db, proof:proof(expected), signingKey:key, expected,
      sessionTokenHash:expected.sessionId, providerToken:'fixture-provider-token',
      consumeNonce:createEvotorOwnerNonceConsumer(db,'fixture-key'), fetchImpl,
    })
  }
  const status = (storeId: string, foreign = false) =>
    readEvotorStoreBindingStatus({
      database:db, productId, storeId,
      companyId:foreign ? companyB : companyA,
      venueId:foreign ? venueB : venueA,
      actorId:foreign ? ownerB : ownerA,
      sessionTokenHash:foreign ? sessionB : sessionA,
    })

  it('inserts a pending binding only after signed owner proof and provider check', async () => {
    expect(await bind(storeA)).toEqual({state:'pending',created:true})
    expect(await status(storeA)).toBe('pending')
    const count = await db.query<{n:string}>('SELECT count(*)::text AS n FROM admin_evotor_store_bindings')
    expect(count.rows[0]!.n).toBe('1')
  })
  it('retries with fresh proofs without duplicate bindings or readiness', async () => {
    expect(await bind(storeA)).toEqual({state:'pending',created:false})
    expect(await bind(storeA)).toEqual({state:'pending',created:false})
    expect(await status(storeA)).toBe('pending')
  })
  it('serializes concurrent duplicate requests using native unique index', async () => {
    const results = await Promise.all(Array.from({length:6}, () => bind(storeB)))
    expect(results.filter(x => x.created)).toHaveLength(1)
    expect(results.filter(x => !x.created)).toHaveLength(5)
    expect((await db.query<{n:string}>(
      'SELECT count(*)::text AS n FROM admin_evotor_store_bindings WHERE store_id=$1',[storeB],
    )).rows[0]!.n).toBe('1')
  })
  it('persists a sticky hold on a verified cross-tenant claim, without leaking prior tenant', async () => {
    await expect(bind(storeA,true)).rejects.toMatchObject({code:'EVOTOR_STORE_BINDING_CONFLICT',statusCode:409})
    expect(await status(storeA)).toBe('hold')
    expect(await status(storeA,true)).toBeNull()
    await expect(bind(storeA)).rejects.toMatchObject({code:'EVOTOR_STORE_BINDING_CONFLICT'})
    const record = await db.query<{company_id:string;state:string;conflict_at:string}>(
      'SELECT company_id::text,state,conflict_at::text FROM admin_evotor_store_bindings WHERE store_id=$1',[storeA],
    )
    expect(record.rows[0]!.company_id).toBe(companyA)
    expect(record.rows[0]!.state).toBe('hold')
    expect(record.rows[0]!.conflict_at).toBeTruthy()
  })
  it('serializes simultaneous claims by different valid owners into one sticky hold', async () => {
    const results = await Promise.allSettled([bind(storeC), bind(storeC, true)])
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.filter(x => x.status === 'rejected') as PromiseRejectedResult[]
    expect(rejected).toHaveLength(1)
    expect(rejected[0]!.reason).toMatchObject({code:'EVOTOR_STORE_BINDING_CONFLICT'})
    const rows = await db.query<{company_id:string;state:string}>(
      'SELECT company_id::text,state FROM admin_evotor_store_bindings WHERE store_id=$1',[storeC],
    )
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0]!.state).toBe('hold')
    expect([companyA,companyB]).toContain(rows.rows[0]!.company_id)
    const visible = [await status(storeC), await status(storeC,true)]
    expect(visible.filter(x => x === 'hold')).toHaveLength(1)
    expect(visible.filter(x => x === null)).toHaveLength(1)
  })
  it('never grants another tenant access by changing IDs or a session', async () => {
    expect(await status(storeB,true)).toBeNull()
    expect(await readEvotorStoreBindingStatus({
      database:db, productId, storeId:storeB, companyId:companyA,
      venueId:venueA, actorId:ownerB, sessionTokenHash:sessionB,
    })).toBeNull()
    expect(await readEvotorStoreBindingStatus({
      database:db, productId, storeId:storeB, companyId:companyA,
      venueId:venueA, actorId:ownerA, sessionTokenHash:sessionB,
    })).toBeNull()
  })
  it('fails closed after token rotation, then requires a new signed proof', async () => {
    await db.query('UPDATE admin_evotor_market_users SET token_revision=2 WHERE product_id=$1',[productId])
    try {
      expect(await status(storeB)).toBe('disconnected')
      await expect(bind(storeB)).rejects.toMatchObject({code:'EVOTOR_BINDING_UNAVAILABLE'})
      expect(await bind(storeB,false,'2')).toEqual({state:'pending',created:false})
      expect(await status(storeB)).toBe('pending')
    } finally {
      await db.query('UPDATE admin_evotor_market_users SET token_revision=1 WHERE product_id=$1',[productId])
    }
    expect(await status(storeB)).toBe('disconnected')
  })
  it('denies uninstalled and reconciliation-held provider identity on status reads', async () => {
    await db.query("UPDATE admin_evotor_market_users SET installation_state='uninstalled',token_revision=1 WHERE product_id=$1",[productId])
    try { expect(await status(storeB)).toBe('disconnected') }
    finally { await db.query("UPDATE admin_evotor_market_users SET installation_state='installed' WHERE product_id=$1",[productId]) }
    await db.query('UPDATE admin_evotor_market_users SET reconciliation_required=TRUE WHERE product_id=$1',[productId])
    try { expect(await status(storeB)).toBe('disconnected') }
    finally { await db.query('UPDATE admin_evotor_market_users SET reconciliation_required=FALSE WHERE product_id=$1',[productId]) }
  })
  it('rejects inactive/expired owner session and leaves a revoked binding revoked', async () => {
    await db.query("UPDATE admin_sessions SET expires_at=NOW()-INTERVAL '1 minute' WHERE token_hash=$1",[sessionA])
    try { expect(await status(storeB)).toBeNull() }
    finally { await db.query("UPDATE admin_sessions SET expires_at=NOW()+INTERVAL '1 hour' WHERE token_hash=$1",[sessionA]) }
    await db.query("UPDATE admin_evotor_store_bindings SET state='revoked' WHERE store_id=$1",[storeB])
    expect(await status(storeB)).toBe('revoked')
    await expect(bind(storeB)).rejects.toMatchObject({code:'EVOTOR_STORE_BINDING_CONFLICT'})
    expect(await status(storeB)).toBe('revoked')
  })
  it('immediately denies a revoked company owner grant on existing and new store bindings', async () => {
    const unboundStore = 'fixture-store-revoked-owner'
    const removed = await db.query(
      'DELETE FROM admin_company_access WHERE admin_id=$1 AND company_id=$2 AND access_kind=$3 RETURNING admin_id',
      [ownerA, companyA, 'owner'],
    )
    expect(removed.rowCount).toBe(1)
    try {
      expect(await status(storeB)).toBeNull()
      await expect(bind(unboundStore)).rejects.toMatchObject({
        code: 'EVOTOR_BINDING_DENIED', statusCode: 403,
      })
      const count = await db.query<{n:string}>(
        'SELECT count(*)::text AS n FROM admin_evotor_store_bindings WHERE store_id=$1',
        [unboundStore],
      )
      expect(count.rows[0]!.n).toBe('0')
    } finally {
      await db.query(
        "INSERT INTO admin_company_access(admin_id,company_id,access_kind) VALUES($1,$2,'owner')",
        [ownerA, companyA],
      )
    }
    expect(await status(storeB)).toBe('revoked')
  })

})
