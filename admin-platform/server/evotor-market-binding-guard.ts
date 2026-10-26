/**
 * UNMOUNTED P0.2 binding-time prerequisite, NOT a route, license or tenant
 * activation. A trusted issuer must authenticate the provider independently
 * before issuing the signed one-time proof. Never accept a browser-selected
 * provider token, store list or canonical scope as authority.
 *
 * The provider GET is outside the SQL transaction. Inside it, FOR SHARE locks
 * keep session, canonical owner grant, venue and token revision stable through
 * the caller's binding write. The caller MUST write through onVerified(client),
 * implement an idempotent binding and enforce revocation on future reads.
 */
import type { Pool, PoolClient } from 'pg'
import { verifyEvotorOwnerProofOnce, type EvotorOwnerProofScope } from './evotor-market-owner-proof.js'
import { verifyEvotorMarketStoresAtRevision } from './evotor-market-stores.js'

export class EvotorBindingGuardError extends Error {
  readonly code: string
  readonly statusCode: number
  constructor(code: 'EVOTOR_BINDING_DENIED' | 'EVOTOR_BINDING_UNAVAILABLE') {
    super('Не удалось подтвердить привязку магазина Эвотора.')
    this.code = code
    this.statusCode = code === 'EVOTOR_BINDING_DENIED' ? 403 : 503
  }
}
const denied = () => new EvotorBindingGuardError('EVOTOR_BINDING_DENIED')
const unavailable = () => new EvotorBindingGuardError('EVOTOR_BINDING_UNAVAILABLE')
function positiveId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value)
    && BigInt(value) <= 9223372036854775807n
}
const hashPattern = /^[0-9a-f]{64}$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export async function withEvotorOwnerBindingGuard<T>({
  database, proof, signingKey, expected, sessionTokenHash, providerToken,
  consumeNonce, onVerified, fetchImpl,
}: {
  database: Pick<Pool, 'connect' | 'query'>
  proof: string
  signingKey: Buffer
  expected: EvotorOwnerProofScope
  sessionTokenHash: string
  providerToken: string
  consumeNonce: (nonce: string, expiresAt: number) => Promise<boolean>
  onVerified: (client: PoolClient) => Promise<T>
  fetchImpl?: typeof fetch
}): Promise<T> {
  if (!expected || typeof expected !== 'object'
    || !positiveId(expected.spaceverseUserId) || !positiveId(expected.companyId)
    || !positiveId(expected.venueId)
    || typeof expected.sessionId !== 'string' || !hashPattern.test(expected.sessionId)
    || typeof sessionTokenHash !== 'string' || !hashPattern.test(sessionTokenHash)
    || sessionTokenHash !== expected.sessionId
    || typeof expected.productId !== 'string' || !uuidPattern.test(expected.productId)
    || typeof expected.providerUserId !== 'string' || typeof expected.storeId !== 'string'
    || typeof expected.tokenRevision !== 'string'
    || typeof onVerified !== 'function' || !database
    || typeof database.connect !== 'function' || typeof database.query !== 'function') throw denied()

  // Authenticate and consume the one-time proof BEFORE any provider network call.
  // Failed/unavailable provider checks require a new proof, never a replay.
  await verifyEvotorOwnerProofOnce({ proof, signingKey, expected, consumeNonce })

  // Only current primary-DB installation/credential state is eligible.
  const readRevision = async (): Promise<string | null> => {
    const result = await database.query<{ token_revision: string }>(
      `SELECT token_revision::text FROM admin_evotor_market_users
       WHERE product_id=$1::uuid AND user_id=$2
         AND installation_state='installed' AND reconciliation_required=FALSE
         AND secret_ciphertext IS NOT NULL`,
      [expected.productId, expected.providerUserId],
    )
    return result.rows[0]?.token_revision ?? null
  }
  let stores
  try {
    stores = await verifyEvotorMarketStoresAtRevision({
      token: providerToken, expectedUserId: expected.providerUserId,
      expectedTokenRevision: expected.tokenRevision, readCurrentTokenRevision: readRevision, fetchImpl,
    })
  } catch { throw unavailable() }
  if (!stores.some(store => store.storeId === expected.storeId
    && store.userId === expected.providerUserId)) throw denied()

  let client: PoolClient
  try { client = await database.connect() }
  catch { throw unavailable() }
  let begun = false
  try {
    await client.query('BEGIN')
    begun = true
    // Fixed lock order. No SUPER_ADMIN bypass or manager/trusted access here.
    const checks: Array<[string, string[]]> = [
      [`SELECT id FROM admin_accounts
        WHERE id=$1::bigint AND active=TRUE FOR SHARE`, [expected.spaceverseUserId]],
      [`SELECT token_hash FROM admin_sessions
        WHERE token_hash=$1 AND admin_id=$2::bigint AND expires_at>NOW() FOR SHARE`,
        [sessionTokenHash, expected.spaceverseUserId]],
      [`SELECT id FROM companies
        WHERE id=$1::bigint AND active=TRUE FOR SHARE`, [expected.companyId]],
      [`SELECT id FROM venues
        WHERE id=$1::bigint AND company_id=$2::bigint
          AND active=TRUE FOR SHARE`, [expected.venueId, expected.companyId]],
      [`SELECT admin_id FROM admin_company_access
        WHERE admin_id=$1::bigint AND company_id=$2::bigint
          AND access_kind='owner' FOR SHARE`, [expected.spaceverseUserId, expected.companyId]],
      [`SELECT user_id FROM admin_evotor_market_users
        WHERE product_id=$1::uuid AND user_id=$2 AND token_revision=$3::bigint
          AND installation_state='installed' AND reconciliation_required=FALSE
          AND secret_ciphertext IS NOT NULL FOR SHARE`,
        [expected.productId, expected.providerUserId, expected.tokenRevision]],
    ]
    for (const [sql, params] of checks) {
      const result = await client.query(sql, params)
      if (result.rowCount !== 1) throw denied()
    }
    const result = await onVerified(client)
    await client.query('COMMIT')
    begun = false
    return result
  } catch (error) {
    if (begun) await client.query('ROLLBACK').catch(() => undefined)
    if (error instanceof EvotorBindingGuardError) throw error
    throw unavailable()
  } finally { client.release() }
}
