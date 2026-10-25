// @vitest-environment node
import http from 'node:http'
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEvotorMarketInbox, evotorMarketSettings } from '../evotor-market.js'
import { onboardingSecretBox } from '../onboarding-secrets.js'
import { tenantCrmFixtureDatabase, type TenantCrmFixtureDatabase } from './tenant-crm-database-fixture.js'

const productId = 'c0d01535-5193-4cc2-9bfb-be20e0679498'
const otherProduct = 'c0d01535-5193-4cc2-9bfb-be20e0679499'
const authorization = 'Bearer fixture-only-market-application-credential-1234567890'
const env: NodeJS.ProcessEnv = {
  ADMIN_ENABLE_EVOTOR_MARKET_WEBHOOKS: 'true', ADMIN_EVOTOR_MARKET_PRODUCT_ID: productId,
  ADMIN_EVOTOR_MARKET_AUTHORIZATION: authorization,
  ADMIN_ONBOARDING_SECRET_ACTIVE_KEY_ID: 'fixture',
  ADMIN_ONBOARDING_SECRET_KEYRING: JSON.stringify({ fixture: Buffer.alloc(32, 7).toString('base64') }),
}
const cloudToken = 'fixture-only-cloud-api-token-never-returned'
const sub = (subscriptionId: string, sequenceNumber: number, type: string, extra = {}) => ({ subscriptionId, productId,
  userId: '01-fixture', timestamp: '2026-10-23T17:00:00.000+0000', sequenceNumber, type,
  ...(type === 'SubscriptionCreated' ? { planId: 'start-monthly', trialPeriodDuration: 'P14DT' } : {}),
  ...(['SubscriptionActivated', 'SubscriptionRenewed'].includes(type) ? { nextBillingDate: '2026-11-23T17:00:00Z' } : {}), ...extra })
const install = (type = 'ApplicationInstalled', timestamp: number | string = 1792774800000, extra = {}) => ({
  id: crypto.randomUUID(), timestamp, version: 2, type, data: { productId, userId: '01-fixture' }, ...extra,
})

describe('Evotor Market: real HTTP + durable isolated SQL, no activation or external requests', () => {
  let db: TenantCrmFixtureDatabase, server: http.Server, origin = '', queries = 0
  let failWrites = false, failCommit = false
  beforeAll(async () => {
    db = await tenantCrmFixtureDatabase()
    for (const file of ['018_evotor_market_inbox.sql', '019_evotor_market_reconciliation.sql'])
      await db.exec(await fs.readFile(new URL('../../admin-migrations/' + file, import.meta.url), 'utf8'))
    // PGlite has one SQL connection; serialize transactions like a size-one pool.
    // Native tests use independent real connections and row locks instead.
    let queue = Promise.resolve()
    const database = { async connect() {
      let unlock = () => {}
      if (!db.connect) {
        const previous = queue; queue = new Promise<void>(resolve => { unlock = resolve }); await previous
      }
      const client = db.connect ? await db.connect() : { query: db.query.bind(db), release() {} }
      return { async query(sql: string, params?: unknown[]) {
        queries++
        if ((failWrites && sql.startsWith('UPDATE admin_evotor_market_')) || (failCommit && sql === 'COMMIT')) {
          throw new Error('postgres://private:DO_NOT_LEAK@secret.invalid/internal')
        }
        return client.query(sql, params)
      }, release() { client.release(); unlock() } }
    } } as unknown as Pick<Pool, 'connect'>
    const enabled = createEvotorMarketInbox(database, env)
    const disabled = createEvotorMarketInbox(database, {})
    server = http.createServer((req, res) => {
      const url = new URL(req.url!, origin)
      const receiver = url.pathname.startsWith('/disabled') ? disabled : enabled
      url.pathname = url.pathname.replace(/^\/disabled/, '')
      void receiver.handle(req, res, url).then(handled => { if (!handled) { res.statusCode = 404; res.end() } })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
  }, 30_000)
  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
    await db.close()
  })
  const request = (path: string, body: unknown, auth = authorization, method = 'POST', contentType = 'application/json') => fetch(origin + path, {
    method, headers: { authorization: auth, 'content-type': contentType }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  })
  const events = '/api/v1/subscription/event', installations = '/api/v1/installation/event', tokens = '/api/v1/user/token'
  const readSub = async (id: string) => (await db.query('SELECT * FROM admin_evotor_market_subscriptions WHERE subscription_id=$1', [id])).rows[0]!

  it('disabled/auth/method/body/product boundaries reject before SQL; browser credentials do not authenticate', async () => {
    const before = queries
    expect((await request('/disabled' + tokens, {})).status).toBe(404)
    expect((await request(tokens, {}, '')).status).toBe(401)
    expect((await request(tokens, {}, 'Bearer ' + cloudToken)).status).toBe(401)
    expect((await request(tokens, {}, authorization, 'GET')).status).toBe(405)
    expect((await request(tokens, {}, authorization, 'POST', 'text/plain')).status).toBe(400)
    expect((await request(tokens + '?companyId=10', { userId: '01-fixture', token: cloudToken })).status).toBe(400)
    for (const body of [null, [], {}, { userId: '01-fixture', token: cloudToken, companyId: '10' }]) {
      expect((await request(tokens, body)).status).toBe(400)
    }
    expect((await request(installations, install('ApplicationInstalled', 1, { data: { productId: otherProduct, userId: '01-fixture' } }))).status).toBe(400)
    expect(queries).toBe(before)
  })
  it('requires valid product/strong app credentials/keyring to enable; no guessed provider authentication', () => {
    expect(evotorMarketSettings({})).toBeNull()
    for (const overrides of [{ ADMIN_EVOTOR_MARKET_PRODUCT_ID: 'bad' }, { ADMIN_EVOTOR_MARKET_AUTHORIZATION: cloudToken },
      { ADMIN_ONBOARDING_SECRET_KEYRING: '' }]) expect(() => evotorMarketSettings({ ...env, ...overrides })).toThrow()
  })
  it('stores cloud token encrypted, replay does not increment; rotation cannot leak to response or raw event payload', async () => {
    for (let n = 0; n < 2; n++) {
      const response = await request(tokens, { userId: '01-fixture', token: cloudToken })
      expect(response.status).toBe(200); expect(await response.text()).toBe('')
    }
    let row = (await db.query('SELECT * FROM admin_evotor_market_users WHERE user_id=$1', ['01-fixture'])).rows[0]!
    expect(Number(row.token_revision)).toBe(1)
    expect(Buffer.from(row.secret_ciphertext as Uint8Array).toString()).not.toContain(cloudToken)
    const box = onboardingSecretBox(env), aad = `evotor-market-token-v1:${productId}:01-fixture`
    const envelope = { keyId: row.secret_key_id as string, nonce: row.secret_nonce as Uint8Array,
      ciphertext: row.secret_ciphertext as Uint8Array, authTag: row.secret_auth_tag as Uint8Array }
    expect(box.decrypt(envelope, aad)).toBe(cloudToken)
    expect(() => box.decrypt(envelope, aad + '-foreign')).toThrow()
    expect((await request(tokens, { userId: '01-fixture', token: cloudToken + '-rotated' })).status).toBe(200)
    row = (await db.query('SELECT * FROM admin_evotor_market_users WHERE user_id=$1', ['01-fixture'])).rows[0]!
    expect(Number(row.token_revision)).toBe(2)
    expect(row.installation_state).toBe('unknown')
    expect((await db.query('SELECT COUNT(*)::int AS n FROM admin_evotor_market_events')).rows[0]!.n).toBe(0)
  })
  it('installation/uninstall replays are durable; older install cannot undo uninstall; equal-time contradiction denies', async () => {
    const first = install(), second = install('ApplicationUninstalled', 1792774800010)
    for (const body of [first, first, second, { ...first, id: crypto.randomUUID(), timestamp: '1792774800005' }])
      expect((await request(installations, body)).status).toBe(200)
    const state = async () => (await db.query('SELECT installation_state FROM admin_evotor_market_users WHERE user_id=$1', ['01-fixture'])).rows[0]!.installation_state
    expect(await state()).toBe('uninstalled')
    expect((await request(installations, { ...second, type: 'ApplicationInstalled' })).status).toBe(409)
    expect(await state()).toBe('ambiguous')
    expect((await request(installations, install('ApplicationInstalled', second.timestamp))).status).toBe(200)
    expect(await state()).toBe('ambiguous')
    expect((await request(installations, install('ApplicationInstalled', 1792774800020))).status).toBe(200)
    expect(await state()).toBe('ambiguous')
  })
  it('out-of-order payments wait for a contiguous sequence; duplicate delivery/order of JSON keys is harmless', async () => {
    const id = crypto.randomUUID(), paid = sub(id, 2, 'SubscriptionActivated')
    expect((await request(events, paid)).status).toBe(200)
    expect((await readSub(id)).state).toBe('pending'); expect(Number((await readSub(id)).last_sequence)).toBe(0)
    expect((await readSub(id)).has_sequence_gap).toBe(true)
    expect((await request(events, sub(id, 1, 'SubscriptionCreated'))).status).toBe(200)
    expect((await readSub(id)).state).toBe('active'); expect(Number((await readSub(id)).last_sequence)).toBe(2)
    expect((await readSub(id)).has_sequence_gap).toBe(false)
    expect((await request(events, Object.fromEntries(Object.entries(paid).reverse()))).status).toBe(200)
    expect(Number((await readSub(id)).last_sequence)).toBe(2)
    expect((await request(events, sub(id, 3, 'SubscriptionTerminationRequested'))).status).toBe(200)
    expect((await readSub(id)).state).toBe('termination_requested')
    expect((await request(events, sub(id, 4, 'SubscriptionRenewed'))).status).toBe(200)
    expect((await readSub(id)).state).toBe('active')
    expect((await request(events, sub(id, 5, 'SubscriptionTerminated'))).status).toBe(200)
    expect((await readSub(id)).state).toBe('terminated')
    expect((await request(events, sub(id, 6, 'SubscriptionRenewed'))).status).toBe(200)
    expect((await readSub(id)).state).toBe('review_required')
  })
  it('drains an acknowledged backlog longer than one batch after the missing first event arrives', async () => {
    const id = crypto.randomUUID()
    // Persist signed-callback-equivalent inbox rows directly to avoid 1000 redundant HTTP requests.
    // The actual HTTP receiver must drain the entire existing contiguous prefix.
    await db.query(`INSERT INTO admin_evotor_market_users(product_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [productId, '01-fixture'])
    const values = Array.from({ length: 1001 }, (_, i) => sub(id, i + 2, 'SubscriptionRenewed'))
    await db.query(`INSERT INTO admin_evotor_market_events(event_key,product_id,user_id,kind,payload_sha256,payload)
      SELECT 'subscription:'||($1::jsonb->>0)||':'||(event->>'sequenceNumber'),$2::uuid,'01-fixture','subscription',
      repeat('0',64),event FROM jsonb_array_elements($3::jsonb) AS event`, [JSON.stringify([id]), productId, JSON.stringify(values)])
    expect((await request(events, sub(id, 1, 'SubscriptionCreated'))).status).toBe(200)
    expect(Number((await readSub(id)).last_sequence)).toBe(1002)
    expect((await readSub(id)).state).toBe('active')
    expect((await readSub(id)).has_sequence_gap).toBe(false)
  })
  it('simultaneous retries commit one event and preserve identity isolation across provider users', async () => {
    const id = crypto.randomUUID(), event = sub(id, 1, 'SubscriptionCreated')
    const responses = await Promise.all([request(events, event), request(events, event)])
    expect(responses.map(response => response.status)).toEqual([200, 200])
    expect((await db.query('SELECT COUNT(*)::int AS n FROM admin_evotor_market_events WHERE event_key=$1', [`subscription:${id}:1`])).rows[0]!.n).toBe(1)
    expect((await request(events, sub(id, 2, 'SubscriptionActivated', { userId: 'another-user' }))).status).toBe(409)
    expect((await readSub(id)).user_id).toBe('01-fixture')
    expect((await db.query('SELECT COUNT(*)::int AS n FROM admin_evotor_market_users WHERE user_id=$1', ['another-user'])).rows[0]!.n).toBe(0)
  })
  it('plan/add-on changes never silently expand access; trial/create and malformed first sequence never become paid', async () => {
    for (const [type, extra] of [['SubscriptionTermsChanged', { planId: 'pro' }], ['AddonsUpdated', { addons: [{ id: 'ai', quantity: 1 }] }]] as const) {
      const id = crypto.randomUUID()
      for (const body of [sub(id, 1, 'SubscriptionCreated'), sub(id, 2, 'SubscriptionActivated'), sub(id, 3, type, extra)])
        expect((await request(events, body)).status).toBe(200)
      expect((await readSub(id)).state).toBe('review_required')
    }
    const id = crypto.randomUUID()
    expect((await request(events, sub(id, 1, 'SubscriptionActivated'))).status).toBe(200)
    expect((await readSub(id)).state).toBe('review_required')
    const reused = crypto.randomUUID()
    for (const body of [sub(reused, 1, 'SubscriptionCreated'), sub(reused, 2, 'SubscriptionActivated'),
      sub(reused, 3, 'SubscriptionTerminated'), sub(reused, 4, 'SubscriptionCreated'), sub(reused, 5, 'SubscriptionActivated')]) {
      expect((await request(events, body)).status).toBe(200)
    }
    expect((await readSub(reused)).state).toBe('review_required')
  })
  it('termination cannot be bypassed by a later termination request and renewal', async () => {
    const id = crypto.randomUUID()
    for (const [index, type] of ['SubscriptionCreated', 'SubscriptionActivated', 'SubscriptionTerminated',
      'SubscriptionTerminationRequested', 'SubscriptionRenewed'].entries()) {
      expect((await request(events, sub(id, index + 1, type))).status).toBe(200)
    }
    expect((await readSub(id)).state).toBe('review_required')
    expect(Number((await readSub(id)).last_sequence)).toBe(5)
  })
  it('conflicting replay holds the original identity durably without storing changed private payload', async () => {
    const id = crypto.randomUUID(), owner = 'conflict-original'
    const first = sub(id, 1, 'SubscriptionCreated', { userId: owner })
    const paid = sub(id, 2, 'SubscriptionActivated', { userId: owner })
    for (const event of [first, paid]) expect((await request(events, event)).status).toBe(200)
    const changed = { ...paid, userId: 'conflict-foreign', planId: 'private-provider-prose-not-to-store' }
    for (let n = 0; n < 2; n++) expect((await request(events, changed)).status).toBe(409)
    const original = (await db.query('SELECT payload FROM admin_evotor_market_events WHERE event_key=$1', [`subscription:${id}:2`])).rows[0]!.payload
    expect(original).toEqual({ ...paid, timestamp: '2026-10-23T17:00:00.000Z', nextBillingDate: '2026-11-23T17:00:00.000Z' })
    const conflicts = await db.query('SELECT * FROM admin_evotor_market_conflicts WHERE event_key=$1', [`subscription:${id}:2`])
    expect(conflicts.rows).toHaveLength(1)
    expect(JSON.stringify(conflicts.rows)).not.toContain(changed.planId)
    const user = async () => (await db.query('SELECT reconciliation_required,installation_state FROM admin_evotor_market_users WHERE user_id=$1', [owner])).rows[0]!
    expect((await user()).reconciliation_required).toBe(true)
    // Provider facts cannot authorize clearing a reconciliation hold.
    for (const event of [paid, sub(id, 3, 'SubscriptionRenewed', { userId: owner }),
      sub(id, 4, 'SubscriptionTerminated', { userId: owner })]) expect((await request(events, event)).status).toBe(200)
    for (const event of [install('ApplicationUninstalled', 1, { data: { productId, userId: owner } }),
      install('ApplicationInstalled', 2, { data: { productId, userId: owner } })]) expect((await request(installations, event)).status).toBe(200)
    expect((await request(tokens, { userId: owner, token: cloudToken })).status).toBe(200)
    expect((await readSub(id)).reconciliation_required).toBe(true)
    expect((await readSub(id)).state).toBe('review_required')
    expect(Number((await readSub(id)).last_sequence)).toBe(4)
    expect(await user()).toEqual({ reconciliation_required: true, installation_state: 'ambiguous' })
  })
  it('holds the ORIGINAL subscription when a new sequence changes provider userId', async () => {
    const subscriptionId = crypto.randomUUID(), originalUser = 'owner-sticky-original', foreignUser = 'owner-sticky-foreign'
    expect((await request(events, sub(subscriptionId, 1, 'SubscriptionCreated', { userId: originalUser }))).status).toBe(200)
    expect((await request(events, sub(subscriptionId, 2, 'SubscriptionActivated', { userId: originalUser }))).status).toBe(200)
    expect((await readSub(subscriptionId)).state).toBe('active')

    const foreign = sub(subscriptionId, 3, 'SubscriptionRenewed', { userId: foreignUser })
    // COMMIT failure must not acknowledge a hold that was rolled back.
    failCommit = true
    try { expect((await request(events, foreign)).status).toBe(503) }
    finally { failCommit = false }
    expect((await readSub(subscriptionId)).state).toBe('active')
    expect((await db.query('SELECT COUNT(*)::int AS n FROM admin_evotor_market_events WHERE event_key=$1',
      [`subscription:${subscriptionId}:3`])).rows[0]!.n).toBe(0)

    expect((await request(events, foreign)).status).toBe(409)
    let held = await readSub(subscriptionId)
    expect(held.user_id).toBe(originalUser)
    expect(held.state).toBe('review_required')
    expect(held.reconciliation_required).toBe(true)
    expect(Number(held.last_sequence)).toBe(2)
    // The valid event remains durable evidence, but cannot grant the foreign user access.
    expect((await db.query('SELECT user_id FROM admin_evotor_market_events WHERE event_key=$1',
      [`subscription:${subscriptionId}:3`])).rows[0]!.user_id).toBe(foreignUser)
    expect((await request(events, foreign)).status).toBe(409)
    expect((await request(events, sub(subscriptionId, 3, 'SubscriptionRenewed', { userId: originalUser }))).status).toBe(409)
    expect((await request(events, sub(subscriptionId, 4, 'SubscriptionRenewed', { userId: originalUser }))).status).toBe(200)
    held = await readSub(subscriptionId)
    expect(held.user_id).toBe(originalUser)
    expect(held.reconciliation_required).toBe(true)
    expect(held.state).toBe('review_required')
  })

  it('concurrent exact/conflicting deliveries cannot restore a held projection', async () => {
    const id = crypto.randomUUID(), event = sub(id, 1, 'SubscriptionCreated')
    expect((await request(events, event)).status).toBe(200)
    const replies = await Promise.all([request(events, event), request(events, { ...event, planId: 'changed' })])
    expect(replies.map(reply => reply.status).sort()).toEqual([200, 409])
    expect((await readSub(id)).reconciliation_required).toBe(true)
    expect((await readSub(id)).state).toBe('review_required')
  })
  it('failed conflict writes/commit return 503; retry commits the hold before 409', async () => {
    const id = crypto.randomUUID(), event = sub(id, 1, 'SubscriptionCreated')
    expect((await request(events, event)).status).toBe(200)
    const changed = { ...event, planId: 'changed' }
    for (const mode of ['write', 'commit']) {
      failWrites = mode === 'write'; failCommit = mode === 'commit'
      const response = await request(events, changed)
      failWrites = failCommit = false
      expect(response.status).toBe(503)
      expect(await response.text()).toBe('{"code":"EVOTOR_MARKET_UNAVAILABLE"}')
      expect((await readSub(id)).reconciliation_required).toBe(false)
      expect((await db.query('SELECT * FROM admin_evotor_market_conflicts WHERE event_key=$1', [`subscription:${id}:1`])).rows).toHaveLength(0)
    }
    expect((await request(events, changed)).status).toBe(409)
    expect((await readSub(id)).reconciliation_required).toBe(true)
  })
  it('invalid schemas, oversized bodies, unsupported versions/event casing and arbitrary properties cannot persist', async () => {
    const id = crypto.randomUUID(), created = sub(id, 1, 'SubscriptionCreated'), before = queries
    for (const body of [{ ...created, sequenceNumber: 1.5 }, { ...created, planId: undefined }, { ...created, type: 'subscriptionCreated' },
      { ...created, timestamp: '2026-10-23' }, { ...created, rawSecret: cloudToken },
      { ...created, timestamp: '2026-02-30T00:00:00Z' }, { ...created, trialPeriodDuration: 'anything' },
      sub(id, 1, 'SubscriptionActivated', { nextBillingDate: undefined }), sub(id, 1, 'AddonsUpdated', { addons: [{ id: 'x', quantity: -1 }] })])
      expect((await request(events, body)).status).toBe(400)
    expect((await request(installations, { ...install(), version: 3 })).status).toBe(400)
    expect((await request(tokens, { userId: '01-fixture', token: 'x'.repeat(40_000) })).status).toBe(413)
    expect(queries).toBe(before)
  })
  it('SQL/commit failures roll back atomically and return retryable errors without private exception text', async () => {
    for (const mode of ['write', 'commit']) {
      const id = crypto.randomUUID(), event = sub(id, 1, 'SubscriptionCreated')
      failWrites = mode === 'write'; failCommit = mode === 'commit'
      const response = await request(events, event)
      failWrites = failCommit = false
      expect(response.status).toBe(503)
      expect(await response.text()).toBe('{"code":"EVOTOR_MARKET_UNAVAILABLE"}')
      expect((await db.query('SELECT COUNT(*)::int AS n FROM admin_evotor_market_events WHERE event_key=$1', [`subscription:${id}:1`])).rows[0]!.n).toBe(0)
      expect((await request(events, event)).status).toBe(200)
    }
  })
  it('manual migration is repeatable and creates only provider metadata, never canonical access or financial tables', async () => {
    for (const file of ['018_evotor_market_inbox.sql', '019_evotor_market_reconciliation.sql'])
      await db.exec(await fs.readFile(new URL('../../admin-migrations/' + file, import.meta.url), 'utf8'))
    expect((await db.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`)).rows.map(row => row.tablename)).toEqual([
      'admin_evotor_market_conflicts', 'admin_evotor_market_events', 'admin_evotor_market_subscriptions', 'admin_evotor_market_users',
    ])
  })
})
