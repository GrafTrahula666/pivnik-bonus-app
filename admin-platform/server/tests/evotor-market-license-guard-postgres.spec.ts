// @vitest-environment node
// Native disposable PostgreSQL ONLY. Synthetic signed entitlement; no live Evotor.
// Test-only 'ready' CHECK alteration does NOT exist in production migration 024.
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { withEvotorPaidLicenseGuard } from '../evotor-market-license-guard.js'
import type { EvotorApprovedLicensePolicy, EvotorLicenseScope } from '../evotor-market-license-policy.js'

const connectionString = String(process.env.ADMIN_INTEGRATION_TEST_DATABASE_URL || '')
const disposable = (() => {
  try { return /^codex_admin_test(?:_|$)/.test(decodeURIComponent(new URL(connectionString).pathname.slice(1))) }
  catch { return false }
})()
const native = connectionString && disposable ? describe : describe.skip
const productId = 'c0d01535-5193-4cc2-9bfb-be20e0679498'
const subscriptionId = 'f1d01535-5193-4cc2-9bfb-be20e0679498'
const providerUserId = 'native-license-provider'
const storeId = 'native-license-store'
const sessionHash = crypto.createHash('sha256').update('native-license-session').digest('hex')
const key = Buffer.alloc(32, 91)
const policy: EvotorApprovedLicensePolicy = {
  approved: true, unit: 'venue', planIds: ['approved-plan'],
  allowTrial: false, allowGrace: false, maxProofAgeMs: 120_000,
}

native('Evotor license gate / native PostgreSQL scope and row-lock regression', () => {
  let setup: pg.Pool, db: pg.Pool, schema = ''
  let ownerId = '', companyId = '', venueId = ''
  beforeAll(async () => {
    setup = new pg.Pool({ connectionString, ssl: false, max: 2 })
    await setup.query('SELECT 1')
    schema = 'evotor_license_' + crypto.randomBytes(8).toString('hex')
    await setup.query('CREATE SCHEMA ' + schema)
    db = new pg.Pool({ connectionString, ssl: false, max: 10, options: '-c search_path=' + schema })
    await db.query("CREATE TABLE bars(id BIGINT PRIMARY KEY,code TEXT,name TEXT,address TEXT); INSERT INTO bars VALUES(1,'pivnik','Fixture','Fixture')")
    for (const file of [
      '001_admin_core.sql', '020_evotor_market_inbox.sql',
      '021_evotor_market_reconciliation.sql', '024_evotor_store_bindings.sql',
    ]) await db.query(await fs.readFile(new URL('../../admin-migrations/' + file, import.meta.url), 'utf8'))
    ownerId = (await db.query<{id:string}>(
      "INSERT INTO admin_accounts(email,display_name,role,password_hash) VALUES('license@invalid.test','Fixture','VENUE_ADMIN','fixture') RETURNING id::text",
    )).rows[0]!.id
    companyId = (await db.query<{id:string}>("SELECT id::text FROM companies WHERE code='pivnik'")).rows[0]!.id
    venueId = (await db.query<{id:string}>('SELECT id::text FROM venues WHERE company_id=$1',[companyId])).rows[0]!.id
    await db.query("INSERT INTO admin_company_access(admin_id,company_id,access_kind) VALUES($1,$2,'owner')",[ownerId,companyId])
    await db.query("INSERT INTO admin_sessions(token_hash,admin_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '1 hour')",[sessionHash,ownerId])
    await db.query([
      'INSERT INTO admin_evotor_market_users(product_id,user_id,secret_key_id,secret_nonce,',
      'secret_ciphertext,secret_auth_tag,token_fingerprint,token_revision,installation_state,reconciliation_required)',
      "VALUES($1,$2,'fixture',$3,$4,$5,'fixture',2,'installed',FALSE)",
    ].join(' '),[productId,providerUserId,Buffer.alloc(12,1),Buffer.alloc(24,2),Buffer.alloc(16,3)])
    await db.query([
      'INSERT INTO admin_evotor_market_subscriptions',
      '(subscription_id,product_id,user_id,last_sequence,state,has_sequence_gap,paid_until,plan_id,reconciliation_required)',
      "VALUES($1,$2,$3,3,'active',FALSE,NOW()+INTERVAL '1 hour','approved-plan',FALSE)",
    ].join(' '),[subscriptionId,productId,providerUserId])
    await db.query([
      'INSERT INTO admin_evotor_store_bindings',
      '(product_id,store_id,provider_user_id,company_id,venue_id,owner_admin_id,token_revision)',
      'VALUES($1,$2,$3,$4,$5,$6,2)',
    ].join(' '),[productId,storeId,providerUserId,companyId,venueId,ownerId])
    // Explicitly test the production default-deny pending state first.
  }, 30_000)
  afterAll(async () => {
    await db?.end()
    if (setup) {
      if (schema) await setup.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE')
      await setup.end()
    }
  }, 30_000)
  const scope = (): EvotorLicenseScope => ({
    productId, providerUserId, subscriptionId, companyId, venueId, storeId,
  })
  const signed = (overrides: Record<string, unknown> = {}) => {
    const now = Date.now()
    const claim = {
      purpose: 'spaceverse.evotor.license.v1',
      issuer: 'trusted-provider-license-verifier',
      ...scope(), tokenRevision: '2', planId: 'approved-plan',
      unit: 'venue', status: 'active', verifiedAtMs: now - 1000,
      expiresAtMs: now + 60_000, ...overrides,
    }
    const encoded = Buffer.from(JSON.stringify(claim)).toString('base64url')
    const mac = crypto.createHmac('sha256',key)
      .update('spaceverse.evotor.license.v1\n'+encoded).digest('base64url')
    return encoded + '.' + mac
  }
  const gate = (overrides: Record<string,unknown> = {}, onAuthorized = async () => 'allowed') =>
    withEvotorPaidLicenseGuard({
      database:db, scope:scope(), actorId:ownerId, sessionTokenHash:sessionHash,
      policy, signedEntitlement:signed(), signingKey:key, onAuthorized,
      ...overrides,
    })

  it('denies pending binding even with synthetic signed license and active callback', async () => {
    let called = false
    await expect(gate({},async () => { called=true; return 'unsafe' }))
      .rejects.toMatchObject({code:'EVOTOR_LICENSE_DENIED',statusCode:403})
    expect(called).toBe(false)
    // Test-only schema relaxation: NOT a migration or a real entitlement.
    await db.query('ALTER TABLE admin_evotor_store_bindings DROP CONSTRAINT admin_evotor_store_bindings_state_check')
    await db.query("ALTER TABLE admin_evotor_store_bindings ADD CONSTRAINT fixture_ready_check CHECK (state IN ('pending','hold','revoked','ready'))")
    await db.query("UPDATE admin_evotor_store_bindings SET state='ready'")
  })
  beforeEach(async () => {
    // Test order is sequential. The first test creates a disposable-only ready state.
    if (!(await db.query("SELECT 1 FROM pg_constraint WHERE conname='fixture_ready_check'")).rowCount) return
    await db.query("UPDATE admin_evotor_store_bindings SET state='ready',token_revision=2")
    await db.query("UPDATE admin_evotor_market_users SET installation_state='installed',reconciliation_required=FALSE,token_revision=2")
    await db.query("UPDATE admin_evotor_market_subscriptions SET state='active',has_sequence_gap=FALSE,reconciliation_required=FALSE,paid_until=NOW()+INTERVAL '1 hour',plan_id='approved-plan'")
    await db.query("UPDATE admin_sessions SET expires_at=NOW()+INTERVAL '1 hour'")
    await db.query("UPDATE admin_company_access SET access_kind='owner'")
  })
  it('passes synthetic proof only with test-only ready state and canonical owner', async () => {
    expect(await gate()).toBe('allowed')
  })
  it('denies cross-tenant scope and a foreign actor/session before onAuthorized', async () => {
    await expect(gate({scope:{...scope(),companyId:'999'}}))
      .rejects.toMatchObject({code:'EVOTOR_LICENSE_DENIED'})
    await expect(gate({actorId:'999'})).rejects.toMatchObject({code:'EVOTOR_LICENSE_DENIED'})
    await expect(gate({sessionTokenHash:crypto.createHash('sha256').update('foreign').digest('hex')}))
      .rejects.toMatchObject({code:'EVOTOR_LICENSE_DENIED'})
  })
  it('denies subscription gap and sticky subscription/user reconciliation holds', async () => {
    await db.query('UPDATE admin_evotor_market_subscriptions SET has_sequence_gap=TRUE')
    await expect(gate()).rejects.toMatchObject({code:'EVOTOR_LICENSE_DENIED'})
    await db.query('UPDATE admin_evotor_market_subscriptions SET has_sequence_gap=FALSE,reconciliation_required=TRUE')
    await expect(gate()).rejects.toMatchObject({code:'EVOTOR_LICENSE_DENIED'})
    await db.query('UPDATE admin_evotor_market_subscriptions SET reconciliation_required=FALSE')
    await db.query('UPDATE admin_evotor_market_users SET reconciliation_required=TRUE')
    await expect(gate()).rejects.toMatchObject({code:'EVOTOR_LICENSE_DENIED'})
  })
  it('denies token revision changes, provider uninstall and expired session', async () => {
    await db.query('UPDATE admin_evotor_market_users SET token_revision=3')
    await expect(gate()).rejects.toMatchObject({code:'EVOTOR_LICENSE_DENIED'})
    await db.query("UPDATE admin_evotor_market_users SET token_revision=2,installation_state='uninstalled'")
    await expect(gate()).rejects.toMatchObject({code:'EVOTOR_LICENSE_DENIED'})
    await db.query("UPDATE admin_evotor_market_users SET installation_state='installed'")
    await db.query("UPDATE admin_sessions SET expires_at=NOW()-INTERVAL '1 minute'")
    await expect(gate()).rejects.toMatchObject({code:'EVOTOR_LICENSE_DENIED'})
  })
  it('denies invalid signed evidence and unapproved commercial policy', async () => {
    await expect(gate({signedEntitlement:signed({companyId:'other'})}))
      .rejects.toMatchObject({code:'EVOTOR_LICENSE_DENIED'})
    await expect(gate({policy:{...policy,approved:false}}))
      .rejects.toMatchObject({code:'EVOTOR_LICENSE_DENIED'})
  })
  it('rolls back all callback writes if an authorized operation throws', async () => {
    const before = (await db.query<{token_revision:string}>(
      'SELECT token_revision::text FROM admin_evotor_market_users WHERE product_id=$1',
      [productId],
    )).rows[0]!.token_revision
    let entered = false
    await expect(gate({}, async client => {
      entered = true
      await client.query(
        'UPDATE admin_evotor_market_users SET token_revision=token_revision+1 WHERE product_id=$1',
        [productId],
      )
      throw new Error('synthetic downstream failure')
    })).rejects.toMatchObject({code:'EVOTOR_LICENSE_UNAVAILABLE',statusCode:503})
    expect(entered).toBe(true)
    const after = (await db.query<{token_revision:string}>(
      'SELECT token_revision::text FROM admin_evotor_market_users WHERE product_id=$1',
      [productId],
    )).rows[0]!.token_revision
    expect(after).toBe(before)
    expect(await gate()).toBe('allowed')
  })

  it('holds native row locks across the authorized callback and observes revocation afterwards', async () => {
    let started!: () => void, release!: () => void
    const entered = new Promise<void>(resolve => { started=resolve })
    const held = new Promise<void>(resolve => { release=resolve })
    const running = gate({},async () => { started(); await held; return 'finished' })
    await entered
    let revoked = false
    const update = db.query("UPDATE admin_evotor_market_users SET installation_state='uninstalled'").then(() => {revoked=true})
    try {
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(revoked).toBe(false)
    } finally { release() }
    expect(await running).toBe('finished')
    await update
    expect(revoked).toBe(true)
    await expect(gate()).rejects.toMatchObject({code:'EVOTOR_LICENSE_DENIED'})
  }, 15_000)
})
