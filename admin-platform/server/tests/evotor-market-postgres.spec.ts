// @vitest-environment node
// Native PostgreSQL only. The database must be explicitly disposable; no production fallback.
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEvotorMarketInbox } from '../evotor-market.js'

const connectionString = String(process.env.ADMIN_INTEGRATION_TEST_DATABASE_URL || '')
const safeDatabase = (() => {
  try { return /^codex_admin_test(?:_|$)/.test(decodeURIComponent(new URL(connectionString).pathname.slice(1))) }
  catch { return false }
})()
const nativeSuite = connectionString && safeDatabase ? describe : describe.skip
const productId = 'c0d01535-5193-4cc2-9bfb-be20e0679498'
const authorization = 'Bearer fixture-only-market-application-credential-1234567890'
const env: NodeJS.ProcessEnv = {
  ADMIN_ENABLE_EVOTOR_MARKET_WEBHOOKS: 'true',
  ADMIN_EVOTOR_MARKET_PRODUCT_ID: productId,
  ADMIN_EVOTOR_MARKET_AUTHORIZATION: authorization,
  ADMIN_ONBOARDING_SECRET_ACTIVE_KEY_ID: 'fixture',
  ADMIN_ONBOARDING_SECRET_KEYRING: JSON.stringify({ fixture: Buffer.alloc(32, 7).toString('base64') }),
}
const endpoint = '/api/v1/subscription/event'
const event = (id: string, userId: string, sequenceNumber: number, type: string) => ({
  subscriptionId: id, productId, userId, sequenceNumber, type,
  timestamp: '2026-10-23T17:00:00.000+0000',
  ...(type === 'SubscriptionCreated' ? { planId: 'start-monthly', trialPeriodDuration: 'P14DT' } : {}),
  ...(['SubscriptionActivated', 'SubscriptionRenewed'].includes(type)
    ? { nextBillingDate: '2026-11-23T17:00:00Z' } : {}),
})

nativeSuite('Evotor Market native PostgreSQL: actual row locks and durable callback inbox', () => {
  let setup: pg.Pool
  let db: pg.Pool
  let server: http.Server | undefined
  let origin = ''
  let schema = ''

  beforeAll(async () => {
    // Never use a shared/public schema, even inside the disposable test database.
    setup = new pg.Pool({ connectionString, ssl: false, max: 2 })
    await setup.query('SELECT 1')
    schema = 'evotor_market_native_' + crypto.randomBytes(8).toString('hex')
    await setup.query('CREATE SCHEMA ' + schema)
    db = new pg.Pool({ connectionString, ssl: false, max: 8, options: '-c search_path=' + schema })
    for (const file of ['020_evotor_market_inbox.sql', '021_evotor_market_reconciliation.sql']) {
      const sql = await fs.readFile(new URL('../../admin-migrations/' + file, import.meta.url), 'utf8')
      await db.query(sql)
    }
    const receiver = createEvotorMarketInbox(db, env)
    server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      void receiver.handle(req, res, url).then(handled => {
        if (!handled) { res.statusCode = 404; res.end() }
      }).catch(() => { if (!res.headersSent) res.statusCode = 503; res.end() })
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    origin = 'http://127.0.0.1:' + (server.address() as import('node:net').AddressInfo).port
  }, 30_000)

  afterAll(async () => {
    if (server?.listening) await new Promise<void>(resolve => server!.close(() => resolve()))
    await db?.end()
    if (setup) {
      if (schema) await setup.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE')
      await setup.end()
    }
  }, 30_000)

  const send = async (body: unknown, path = endpoint) => {
    const response = await fetch(origin + path, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: response.status, body: await response.text() }
  }

  it('applies 018 then 019 twice in an isolated native schema without canonical tenant tables', async () => {
    for (const file of ['020_evotor_market_inbox.sql', '021_evotor_market_reconciliation.sql'])
      await db.query(await fs.readFile(new URL('../../admin-migrations/' + file, import.meta.url), 'utf8'))
    const tables = await db.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname=current_schema() ORDER BY tablename")
    expect(tables.rows.map(row => row.tablename)).toEqual([
      'admin_evotor_market_conflicts', 'admin_evotor_market_events',
      'admin_evotor_market_subscriptions', 'admin_evotor_market_users',
    ])
  })

  it('serializes simultaneous exact retries using independent PostgreSQL connections', async () => {
    const id = crypto.randomUUID(), userId = 'native-retry-' + crypto.randomUUID()
    const created = event(id, userId, 1, 'SubscriptionCreated')
    const responses = await Promise.all(Array.from({ length: 4 }, () => send(created)))
    expect(responses.map(response => response.status)).toEqual([200, 200, 200, 200])
    const rows = await db.query<{ n: string }>(
      'SELECT COUNT(*)::text AS n FROM admin_evotor_market_events WHERE event_key=$1',
      ['subscription:' + id + ':1'])
    expect(rows.rows[0]!.n).toBe('1')
    const sub = await db.query<{ last_sequence: string; state: string }>(
      'SELECT last_sequence::text,state FROM admin_evotor_market_subscriptions WHERE subscription_id=$1', [id])
    expect(sub.rows[0]).toMatchObject({ last_sequence: '1', state: 'pending' })
  })


  it('rolls back failed token rotation on native PostgreSQL and permits safe concurrent retry', async () => {
    const userId = 'native-token-' + crypto.randomUUID()
    const firstToken = 'fixture-only-initial-cloud-token-' + crypto.randomUUID()
    const rotatedToken = 'fixture-only-rotated-cloud-token-' + crypto.randomUUID()
    const tokenPath = '/api/v1/user/token'
    const readToken = async () => (await db.query<{
      token_revision: string; token_fingerprint: string; secret_ciphertext: Buffer
    }>(`SELECT token_revision::text,token_fingerprint,secret_ciphertext
        FROM admin_evotor_market_users WHERE product_id=$1 AND user_id=$2`, [productId, userId])).rows[0]!

    expect((await send({ userId, token: firstToken }, tokenPath)).status).toBe(200)
    const initial = await readToken()
    expect(initial.token_revision).toBe('1')
    expect(initial.secret_ciphertext.toString('utf8')).not.toContain(firstToken)

    // A real PostgreSQL CHECK violation aborts the UPDATE after BEGIN and
    // row locking. The inbox must roll back the whole request and return 503.
    await db.query(`ALTER TABLE admin_evotor_market_users
      ADD CONSTRAINT native_token_rotation_guard CHECK (token_revision <= 1)`)
    try {
      const rejected = await send({ userId, token: rotatedToken }, tokenPath)
      expect(rejected.status).toBe(503)
      expect(rejected.body).not.toContain(rotatedToken)
      expect(rejected.body).not.toContain(firstToken)
      expect(await readToken()).toEqual(initial)
    } finally {
      await db.query('ALTER TABLE admin_evotor_market_users DROP CONSTRAINT native_token_rotation_guard')
    }

    const retries = await Promise.all(Array.from({ length: 3 },
      () => send({ userId, token: rotatedToken }, tokenPath)))
    expect(retries.map(response => response.status)).toEqual([200, 200, 200])
    const updated = await readToken()
    expect(updated.token_revision).toBe('2')
    expect(updated.token_fingerprint).not.toBe(initial.token_fingerprint)
    expect(updated.secret_ciphertext.toString('utf8')).not.toContain(rotatedToken)
  })

  it('keeps the original owner and sticky hold across cross-user concurrent callbacks and a real row lock', async () => {
    const id = crypto.randomUUID(), owner = 'native-owner-' + crypto.randomUUID()
    const foreign = 'native-foreign-' + crypto.randomUUID()
    expect((await send(event(id, owner, 1, 'SubscriptionCreated'))).status).toBe(200)
    expect((await send(event(id, owner, 2, 'SubscriptionActivated'))).status).toBe(200)

    const locker = await db.connect()
    await locker.query('BEGIN')
    try {
      await locker.query('SELECT user_id FROM admin_evotor_market_users WHERE product_id=$1 AND user_id=$2 FOR UPDATE',
        [productId, owner])
      const pending = Promise.all([
        send(event(id, owner, 3, 'SubscriptionRenewed')),
        send(event(id, foreign, 3, 'SubscriptionRenewed')),
      ])
      // Prove that an HTTP callback actually waits on a native PostgreSQL lock,
      // rather than accepting an in-memory/PGlite serialization as evidence.
      let waiting = false
      for (let attempt = 0; attempt < 80; attempt++) {
        const activity = await setup.query<{ n: string }>(
          "SELECT COUNT(*)::text AS n FROM pg_stat_activity WHERE datname=current_database() " +
          "AND wait_event_type='Lock' AND query ILIKE '%admin_evotor_market_users%'")
        if (Number(activity.rows[0]!.n) > 0) { waiting = true; break }
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      expect(waiting).toBe(true)
      await locker.query('ROLLBACK')
      const results = await pending
      expect(results.every(result => [200, 409].includes(result.status))).toBe(true)
      expect(results.some(result => result.status === 409)).toBe(true)
      expect(results.map(result => result.body).join('')).not.toContain('native-foreign-')
    } finally {
      // Releasing a held row is mandatory even if the wait assertion fails.
      await locker.query('ROLLBACK').catch(() => undefined)
      locker.release()
    }

    const held = await db.query<{ user_id: string; state: string; reconciliation_required: boolean }>(
      'SELECT user_id,state,reconciliation_required FROM admin_evotor_market_subscriptions WHERE subscription_id=$1', [id])
    expect(held.rows[0]).toMatchObject({
      user_id: owner, state: 'review_required', reconciliation_required: true,
    })
    const foreignUser = await db.query<{ secret_key_id: string | null; installation_state: string }>(
      'SELECT secret_key_id,installation_state FROM admin_evotor_market_users WHERE product_id=$1 AND user_id=$2',
      [productId, foreign])
    expect(foreignUser.rows[0]).toMatchObject({ secret_key_id: null, installation_state: 'unknown' })
    expect((await send(event(id, owner, 4, 'SubscriptionRenewed'))).status).toBe(200)
    const stillHeld = await db.query<{ state: string; reconciliation_required: boolean }>(
      'SELECT state,reconciliation_required FROM admin_evotor_market_subscriptions WHERE subscription_id=$1', [id])
    expect(stillHeld.rows[0]).toMatchObject({ state: 'review_required', reconciliation_required: true })
  })
})
