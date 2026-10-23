import crypto from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Pool, PoolClient } from 'pg'
import { onboardingSecretBox } from './onboarding-secrets.js'
import { readJsonBody, safeEqual, securityHeaders } from './security.js'
import { HttpError } from './types.js'

// Official contracts and unresolved provider gates: ops/EVOTOR-MARKET-RUNBOOK.md.
// This inbox never creates companies, grants access, activates CRM or calls a provider.
const paths = new Map([
  ['/api/v1/user/token', 'token'],
  ['/api/v1/installation/event', 'installation'],
  ['/api/v1/subscription/event', 'subscription'],
] as const)
type Kind = 'token' | 'installation' | 'subscription'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const invalid = () => new HttpError(400, 'EVOTOR_MARKET_INVALID', 'Invalid Evotor callback.')
const unavailable = () => new HttpError(503, 'EVOTOR_MARKET_UNAVAILABLE', 'Evotor callbacks are unavailable.')
const conflict = () => new HttpError(409, 'EVOTOR_MARKET_CONFLICT', 'Conflicting Evotor callback; reconciliation required.')
function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid()
  return raw as Record<string, unknown>
}
function text(raw: unknown, max = 128): string {
  if (typeof raw !== 'string' || !raw.length || raw.length > max
    || Array.from(raw).some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)) throw invalid()
  return raw
}
function id(raw: unknown): string {
  const value = text(raw)
  if (!uuid.test(value)) throw invalid()
  return value.toLowerCase()
}
function fields(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw invalid()
}
function instant(raw: unknown): string {
  const value = text(raw, 64)
  // Evotor's published ISO example uses +0000; require an explicit offset.
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:?\d\d)$/.test(value)) throw invalid()
  const time = Date.parse(value)
  const day = value.slice(0, 10), calendar = new Date(day + 'T00:00:00Z')
  if (!Number.isFinite(time) || !Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== day
    || Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) throw invalid()
  return new Date(time).toISOString()
}
const types = new Set(['SubscriptionCreated', 'SubscriptionActivated', 'SubscriptionRenewed',
  'SubscriptionTermsChanged', 'SubscriptionTerminationRequested', 'SubscriptionTerminated', 'AddonsUpdated'])
interface Subscription {
  subscriptionId: string; productId: string; userId: string; timestamp: string
  sequenceNumber: number; type: string; planId?: string; nextBillingDate?: string
  trialPeriodDuration?: string; deviceNumber?: number; addons?: { id: string; quantity: number }[]
}
interface Installation {
  id: string; timestamp: number; version: 2
  type: 'ApplicationInstalled' | 'ApplicationUninstalled'
  data: { productId: string; userId: string }
}
function subscription(raw: unknown): Subscription {
  const b = object(raw)
  fields(b, ['subscriptionId', 'productId', 'userId', 'timestamp', 'sequenceNumber', 'type',
    'planId', 'trialPeriodDuration', 'nextBillingDate', 'deviceNumber', 'addons'])
  if (!Number.isSafeInteger(b.sequenceNumber) || Number(b.sequenceNumber) < 1 || !types.has(String(b.type))) throw invalid()
  const result: Subscription = { subscriptionId: id(b.subscriptionId), productId: id(b.productId),
    userId: text(b.userId), timestamp: instant(b.timestamp), sequenceNumber: Number(b.sequenceNumber), type: String(b.type) }
  if (b.planId !== undefined) result.planId = text(b.planId)
  if (b.nextBillingDate !== undefined) result.nextBillingDate = instant(b.nextBillingDate)
  if (b.trialPeriodDuration !== undefined) {
    result.trialPeriodDuration = text(b.trialPeriodDuration, 64)
    if (!/^P\d{1,5}DT$/.test(result.trialPeriodDuration)) throw invalid()
  }
  if (b.deviceNumber !== undefined) {
    if (!Number.isSafeInteger(b.deviceNumber) || Number(b.deviceNumber) < 0) throw invalid()
    result.deviceNumber = Number(b.deviceNumber)
  }
  if (b.addons !== undefined) {
    if (!Array.isArray(b.addons) || b.addons.length > 100) throw invalid()
    result.addons = b.addons.map(value => {
      const addon = object(value); fields(addon, ['id', 'quantity'])
      if (!Number.isSafeInteger(addon.quantity) || Number(addon.quantity) < 0) throw invalid()
      return { id: text(addon.id), quantity: Number(addon.quantity) }
    })
    if (new Set(result.addons.map(addon => addon.id)).size !== result.addons.length) throw invalid()
  }
  if (result.type === 'SubscriptionCreated' && (!result.planId || !result.trialPeriodDuration)) throw invalid()
  if (['SubscriptionActivated', 'SubscriptionRenewed'].includes(result.type) && !result.nextBillingDate) throw invalid()
  if (result.type === 'AddonsUpdated' && !result.addons) throw invalid()
  return result
}
function installation(raw: unknown): Installation {
  const b = object(raw); fields(b, ['id', 'timestamp', 'version', 'type', 'data'])
  const data = object(b.data); fields(data, ['productId', 'userId'])
  // Numeric epoch milliseconds are used in the official example; accept decimal
  // strings as the schema also describes timestamp as a string. No coercion of null.
  const timestamp = typeof b.timestamp === 'string' && /^\d{1,15}$/.test(b.timestamp) ? Number(b.timestamp) : b.timestamp
  if (!Number.isSafeInteger(timestamp) || Number(timestamp) < 0 || Number(timestamp) > 8_640_000_000_000_000
    || b.version !== 2 || !['ApplicationInstalled', 'ApplicationUninstalled'].includes(String(b.type))) throw invalid()
  return { id: id(b.id), timestamp: Number(timestamp), version: 2,
    type: b.type as Installation['type'], data: { productId: id(data.productId), userId: text(data.userId) } }
}
function canonical(raw: unknown): string {
  if (Array.isArray(raw)) return '[' + raw.map(canonical).join(',') + ']'
  if (raw !== null && typeof raw === 'object') return '{' + Object.entries(raw).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => JSON.stringify(key) + ':' + canonical(value)).join(',') + '}'
  return JSON.stringify(raw)
}
export function evotorMarketSettings(env: NodeJS.ProcessEnv = process.env) {
  const enabled = env.ADMIN_ENABLE_EVOTOR_MARKET_WEBHOOKS === 'true'
  if (!enabled) return null
  const productId = String(env.ADMIN_EVOTOR_MARKET_PRODUCT_ID || '').toLowerCase()
  const authorization = String(env.ADMIN_EVOTOR_MARKET_AUTHORIZATION || '')
  if (!uuid.test(productId) || authorization.length < 40 || authorization.length > 4096
    || !/^(Bearer|Basic) [A-Za-z0-9+/=_\-.]+$/.test(authorization)) throw unavailable()
  const box = onboardingSecretBox(env)
  return { productId, authorization, box }
}

export function createEvotorMarketInbox(database: Pick<Pool, 'connect'>, env: NodeJS.ProcessEnv = process.env) {
  async function projectSubscription(client: PoolClient, event: Subscription) {
    await client.query(`INSERT INTO admin_evotor_market_subscriptions(subscription_id,product_id,user_id)
      VALUES($1::uuid,$2::uuid,$3) ON CONFLICT DO NOTHING`, [event.subscriptionId, event.productId, event.userId])
    const current = (await client.query(`SELECT product_id::text,user_id,last_sequence::text,state,paid_until,plan_id
      FROM admin_evotor_market_subscriptions WHERE subscription_id=$1::uuid FOR UPDATE`, [event.subscriptionId])).rows[0]!
    if (current.product_id !== event.productId || current.user_id !== event.userId) throw conflict()
    let sequence = Number(current.last_sequence), state = String(current.state)
    let paidUntil: string | Date | null = current.paid_until, planId: string | null = current.plan_id
    // The user lock serializes deliveries; only the contiguous prefix is projected.
    let gap = false
    // Drain full batches, including a long backlog released by a missing event.
    // Acknowledged events must not depend on an unrelated future callback.
    for (;;) {
    const pending = await client.query<{ payload: Subscription }>(`SELECT payload FROM admin_evotor_market_events
      WHERE kind='subscription' AND product_id=$1::uuid AND user_id=$2
      AND payload->>'subscriptionId'=$3 AND (payload->>'sequenceNumber')::bigint>$4
      ORDER BY (payload->>'sequenceNumber')::bigint LIMIT 1000`, [event.productId, event.userId, event.subscriptionId, sequence])
    for (const { payload: next } of pending.rows) {
      if (next.sequenceNumber !== sequence + 1) { gap = true; break }
      if (sequence === 0 && next.type !== 'SubscriptionCreated') state = 'review_required'
      if (state !== 'review_required') {
        if (next.type === 'SubscriptionCreated') { state = sequence === 0 ? 'pending' : 'review_required'; paidUntil = null }
        if (next.type === 'SubscriptionActivated' || next.type === 'SubscriptionRenewed') {
          // A terminal state cannot be reopened by an old/delayed payment event.
          if (state === 'terminated') state = 'review_required'
          else { state = 'active'; paidUntil = next.nextBillingDate! }
        }
        if (next.type === 'SubscriptionTermsChanged') {
          if (next.nextBillingDate) paidUntil = next.nextBillingDate
          // Terms can alter product/add-on rights: require reconciliation before access.
          state = 'review_required'
        }
        if (next.type === 'AddonsUpdated') state = 'review_required'
        if (next.type === 'SubscriptionTerminationRequested') state = 'termination_requested'
        if (next.type === 'SubscriptionTerminated') state = 'terminated'
        if (next.planId) planId = next.planId
      }
      sequence = next.sequenceNumber
    }
    if (gap || pending.rows.length < 1000) break
    }
    await client.query(`UPDATE admin_evotor_market_subscriptions SET last_sequence=$2,state=$3,paid_until=$4,
      plan_id=$5,has_sequence_gap=$6,updated_at=NOW() WHERE subscription_id=$1::uuid`,
    [event.subscriptionId, sequence, state, paidUntil, planId, gap])
  }

  async function accept(kind: Kind, raw: unknown) {
    const settings = evotorMarketSettings(env)
    if (!settings) throw unavailable()
    let productId = settings.productId, userId: string, eventKey = '', payload: Subscription | Installation | undefined
    let token: string | undefined
    if (kind === 'token') {
      const body = object(raw); fields(body, ['userId', 'token'])
      userId = text(body.userId); token = text(body.token, 4096)
    } else if (kind === 'installation') {
      const event = installation(raw); payload = event
      productId = event.data.productId; userId = event.data.userId; eventKey = 'installation:' + event.id
    } else {
      const event = subscription(raw); payload = event
      productId = event.productId; userId = event.userId
      eventKey = `subscription:${event.subscriptionId}:${event.sequenceNumber}`
    }
    if (productId !== settings.productId) throw invalid()
    const client = await database.connect()
    try {
      await client.query('BEGIN')
      await client.query("SET LOCAL statement_timeout='5s'")
      await client.query(`INSERT INTO admin_evotor_market_users(product_id,user_id)
        VALUES($1::uuid,$2) ON CONFLICT DO NOTHING`, [productId, userId])
      const user = (await client.query(`SELECT token_fingerprint,installation_state,installation_timestamp::text
        FROM admin_evotor_market_users WHERE product_id=$1::uuid AND user_id=$2 FOR UPDATE`, [productId, userId])).rows[0]!
      if (token !== undefined) {
        const aad = `evotor-market-token-v1:${productId}:${userId}`
        const fingerprint = settings.box.fingerprint(settings.box.activeKeyId, aad + ':' + token)
        if (user.token_fingerprint !== fingerprint) {
          const secret = settings.box.encrypt(token, aad)
          await client.query(`UPDATE admin_evotor_market_users SET secret_key_id=$3,secret_nonce=$4,secret_ciphertext=$5,
            secret_auth_tag=$6,token_fingerprint=$7,token_revision=token_revision+1,updated_at=NOW()
            WHERE product_id=$1::uuid AND user_id=$2`, [productId, userId, secret.keyId, secret.nonce,
            secret.ciphertext, secret.authTag, fingerprint])
        }
      } else {
        const serialized = canonical(payload), digest = crypto.createHash('sha256').update(serialized).digest('hex')
        const inserted = await client.query(`INSERT INTO admin_evotor_market_events(event_key,product_id,user_id,kind,payload_sha256,payload)
          VALUES($1,$2::uuid,$3,$4,$5,$6::jsonb) ON CONFLICT DO NOTHING RETURNING event_key`,
        [eventKey, productId, userId, kind, digest, serialized])
        if (!inserted.rows.length) {
          const existing = (await client.query('SELECT payload_sha256 FROM admin_evotor_market_events WHERE event_key=$1', [eventKey])).rows[0]
          if (existing?.payload_sha256 !== digest) throw conflict()
        }
        if (kind === 'installation' && inserted.rows.length) {
          const event = payload as Installation, previous = user.installation_timestamp === null ? null : Number(user.installation_timestamp)
          const incoming = event.type === 'ApplicationInstalled' ? 'installed' : 'uninstalled'
          if (previous === null || event.timestamp >= previous) {
            const state = previous === event.timestamp && user.installation_state !== incoming ? 'ambiguous' : incoming
            await client.query(`UPDATE admin_evotor_market_users SET installation_state=$3,installation_timestamp=$4,
              updated_at=NOW() WHERE product_id=$1::uuid AND user_id=$2`, [productId, userId, state, event.timestamp])
          }
        }
        if (kind === 'subscription') await projectSubscription(client, payload as Subscription)
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      if (error instanceof HttpError) throw error
      throw unavailable()
    } finally { client.release() }
  }

  async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const kind = paths.get(url.pathname as Parameters<typeof paths.get>[0])
    if (!kind) return false
    try {
      const settings = evotorMarketSettings(env)
      if (!settings) { res.statusCode = 404; securityHeaders(res); res.end(); return true }
      if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'POST required.')
      // App-token mode follows the generic official authorization contract.
      // Never fall back to browser sessions, a cloud API token or a user-supplied key.
      const supplied = String(req.headers.authorization || '')
      if (!safeEqual(supplied, settings.authorization)) throw new HttpError(401, 'EVOTOR_MARKET_AUTH_REQUIRED', 'Unauthorized callback.')
      if (url.search || !/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) throw invalid()
      await accept(kind, await readJsonBody(req, 32 * 1024))
      res.statusCode = 200; securityHeaders(res); res.end()
    } catch (error) {
      const known = error instanceof HttpError ? error : unavailable()
      res.statusCode = known.statusCode; securityHeaders(res)
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      // No provider payload, credential, exception text, SQL or account data in errors/logs.
      res.end(JSON.stringify({ code: known.code }))
    }
    return true
  }
  return { handle }
}
