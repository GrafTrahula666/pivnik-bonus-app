/**
 * UNMOUNTED P0.4 PostgreSQL authorization boundary. No route or issuer.
 * No current production binding can be ready (migration 024 is pending-only).
 * A future approved provider verifier must issue signed license evidence.
 * Never use a callback state or a browser-supplied entitlement as authority.
 */
import type { Pool, PoolClient } from 'pg'
import { evaluateEvotorLicensePolicy } from './evotor-market-license-policy.js'
import type { EvotorApprovedLicensePolicy, EvotorLicenseScope } from './evotor-market-license-policy.js'

export class EvotorLicenseDenied extends Error {
  readonly code = 'EVOTOR_LICENSE_DENIED'
  readonly statusCode = 403
  constructor() { super('Доступ по лицензии не подтверждён.') }
}
export class EvotorLicenseUnavailable extends Error {
  readonly code = 'EVOTOR_LICENSE_UNAVAILABLE'
  readonly statusCode = 503
  constructor() { super('Проверка лицензии временно недоступна.') }
}

const id = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value)
  && BigInt(value) <= 9223372036854775807n
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const store = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const session = /^[0-9a-f]{64}$/
const providerId = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= 128
  && !Array.from(v).some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)

interface LicenseRow {
  installation_state: string
  token_revision: string
  has_encrypted_token: boolean
  user_hold: boolean
  subscription_state: string
  subscription_sequence: string
  subscription_gap: boolean
  subscription_hold: boolean
  paid_until_ms: string | null
  plan_id: string | null
  binding_state: string
  binding_revision: string
}

/**
 * Signed proof and policy MUST come from server-only trusted configuration.
 * The actor and session hash MUST come from server authentication.
 * The onAuthorized callback runs before COMMIT while all current scope rows
 * remain locked. This does not bypass the independent tenant RBAC of the API.
 */
export async function withEvotorPaidLicenseGuard<T>({
  database, scope, actorId, sessionTokenHash, policy, signedEntitlement,
  signingKey, onAuthorized,
}: {
  database: Pick<Pool, 'connect'>
  scope: EvotorLicenseScope
  actorId: string
  sessionTokenHash: string
  policy: EvotorApprovedLicensePolicy | null
  signedEntitlement: string
  signingKey: Buffer
  onAuthorized: (client: PoolClient) => Promise<T>
}): Promise<T> {
  if (!database || typeof database.connect !== 'function' || !scope
    || !uuid.test(scope.productId) || !uuid.test(scope.subscriptionId)
    || !providerId(scope.providerUserId) || !store.test(scope.storeId)
    || !id(scope.companyId) || !id(scope.venueId) || !id(actorId)
    || !session.test(sessionTokenHash) || typeof onAuthorized !== 'function'
    || !policy || policy.approved !== true || typeof signedEntitlement !== 'string'
    || !Buffer.isBuffer(signingKey) || signingKey.length < 32) {
    throw new EvotorLicenseDenied()
  }

  let client: PoolClient
  try { client = await database.connect() }
  catch { throw new EvotorLicenseUnavailable() }
  let begun = false
  try {
    await client.query('BEGIN')
    begun = true
    // Exact canonical owner/session, subscription, store, installation and
    // token revision are locked together. A browser-supplied ID alone never
    // proves ownership; no fallback to global company/venue access exists.
    const rows = await client.query<LicenseRow>([
      'SELECT u.installation_state, u.token_revision::text,',
      '(u.secret_ciphertext IS NOT NULL) AS has_encrypted_token,',
      'u.reconciliation_required AS user_hold,',
      'sub.state AS subscription_state, sub.last_sequence::text AS subscription_sequence,',
      'sub.has_sequence_gap AS subscription_gap,',
      'sub.reconciliation_required AS subscription_hold,',
      '(EXTRACT(EPOCH FROM sub.paid_until)*1000)::text AS paid_until_ms,',
      'sub.plan_id, b.state AS binding_state, b.token_revision::text AS binding_revision',
      'FROM admin_evotor_market_users u',
      'JOIN admin_evotor_market_subscriptions sub',
      'ON sub.product_id=u.product_id AND sub.user_id=u.user_id',
      'AND sub.subscription_id=$3::uuid',
      'JOIN admin_evotor_store_bindings b',
      'ON b.product_id=u.product_id AND b.provider_user_id=u.user_id',
      'JOIN companies c ON c.id=b.company_id AND c.active=TRUE',
      'JOIN venues v ON v.id=b.venue_id AND v.company_id=c.id AND v.active=TRUE',
      'JOIN admin_company_access g ON g.company_id=c.id',
      "AND g.access_kind='owner' AND g.admin_id=$7::bigint",
      'JOIN admin_accounts a ON a.id=g.admin_id AND a.active=TRUE',
      'JOIN admin_sessions ses ON ses.admin_id=a.id',
      'AND ses.token_hash=$8 AND ses.expires_at>clock_timestamp()',
      'WHERE u.product_id=$1::uuid AND u.user_id=$2',
      'AND b.store_id=$4 AND b.company_id=$5::bigint AND b.venue_id=$6::bigint',
      'FOR SHARE OF u,sub,b,c,v,g,a,ses',
    ].join(' '), [
      scope.productId, scope.providerUserId, scope.subscriptionId, scope.storeId,
      scope.companyId, scope.venueId, actorId, sessionTokenHash,
    ])
    if (rows.rowCount !== 1) throw new EvotorLicenseDenied()
    const row = rows.rows[0]!
    const paidUntilMs = row.paid_until_ms === null ? null : Number(row.paid_until_ms)
    const allowed = evaluateEvotorLicensePolicy({
      scope,
      snapshot: {
        installation: {
          productId: scope.productId, providerUserId: scope.providerUserId,
          state: row.installation_state, tokenRevision: row.token_revision,
          hasEncryptedToken: row.has_encrypted_token, reconciliationRequired: row.user_hold,
        },
        subscription: {
          productId: scope.productId, providerUserId: scope.providerUserId,
          subscriptionId: scope.subscriptionId, state: row.subscription_state,
          lastSequence: row.subscription_sequence, hasSequenceGap: row.subscription_gap,
          reconciliationRequired: row.subscription_hold, paidUntilMs, planId: row.plan_id,
        },
        binding: {
          productId: scope.productId, providerUserId: scope.providerUserId,
          companyId: scope.companyId, venueId: scope.venueId, storeId: scope.storeId,
          tokenRevision: row.binding_revision, state: row.binding_state,
        },
      },
      policy, signedEntitlement, signingKey,
    })
    if (!allowed) throw new EvotorLicenseDenied()
    const result = await onAuthorized(client)
    await client.query('COMMIT')
    begun = false
    return result
  } catch (error) {
    if (begun) await client.query('ROLLBACK').catch(() => undefined)
    if (error instanceof EvotorLicenseDenied) throw error
    throw new EvotorLicenseUnavailable()
  } finally { client.release() }
}
