/**
 * UNMOUNTED P0.2 durable store binding. A verified OAuth proof and the
 * provider's complete GET /stores are checked by withEvotorOwnerBindingGuard.
 * The write executes INSIDE its canonical-owner + token-revision transaction.
 * No route, tenant activation, paid entitlement or production migration.
 *
 * Pending is NOT ready. Conflicts create a sticky hold, never reassignment.
 * Future fiscal/CRM reads must independently enforce tenant scope, current
 * provider authorization AND license; this status API grants no data access.
 */
import type { Pool, PoolClient } from 'pg'
import { withEvotorOwnerBindingGuard } from './evotor-market-binding-guard.js'
import type { EvotorOwnerProofScope } from './evotor-market-owner-proof.js'

export class EvotorStoreBindingError extends Error {
  readonly code = 'EVOTOR_STORE_BINDING_CONFLICT'
  readonly statusCode = 409
  constructor() { super('Привязка магазина требует проверки владельцем платформы.') }
}

type BindingResult = Readonly<{ state: 'pending'; created: boolean }>
type ConflictResult = Readonly<{ conflict: true }>
const id = (v: unknown): v is string => typeof v === 'string'
  && /^[1-9]\\d{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const store = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const session = /^[0-9a-f]{64}$/

async function persistInsideVerifiedTransaction(
  client: PoolClient, scope: EvotorOwnerProofScope,
): Promise<BindingResult | ConflictResult> {
  const params = [
    scope.productId, scope.storeId, scope.providerUserId,
    scope.companyId, scope.venueId, scope.spaceverseUserId, scope.tokenRevision,
  ]
  const inserted = await client.query(
    `INSERT INTO admin_evotor_store_bindings
      (product_id,store_id,provider_user_id,company_id,venue_id,owner_admin_id,token_revision)
      VALUES($1::uuid,$2,$3,$4::bigint,$5::bigint,$6::bigint,$7::bigint)
      ON CONFLICT(product_id,store_id) DO NOTHING RETURNING state`,
    params,
  )
  if (inserted.rowCount === 1) return Object.freeze({ state: 'pending', created: true })

  // ON CONFLICT waits for concurrent inserts. FOR UPDATE serializes a retry
  // and a foreign claim against the same provider/product/store identity.
  const existing = await client.query<{
    provider_user_id: string; company_id: string; venue_id: string
    owner_admin_id: string; token_revision: string; state: string
  }>(
    `SELECT provider_user_id,company_id::text,venue_id::text,
      owner_admin_id::text,token_revision::text,state
      FROM admin_evotor_store_bindings
      WHERE product_id=$1::uuid AND store_id=$2 FOR UPDATE`,
    [scope.productId, scope.storeId],
  )
  if (existing.rowCount !== 1) throw new Error('binding disappeared')
  const previous = existing.rows[0]!
  if (previous.provider_user_id !== scope.providerUserId
    || previous.company_id !== scope.companyId
    || previous.venue_id !== scope.venueId
    || previous.owner_admin_id !== scope.spaceverseUserId) {
    // Commit the hold even though the caller receives 409 AFTER the commit.
    // Never reveal the prior tenant, provider user or owner to the claimant.
    await client.query(
      `UPDATE admin_evotor_store_bindings
       SET state='hold', conflict_at=NOW(), updated_at=NOW()
       WHERE product_id=$1::uuid AND store_id=$2 AND state<>'revoked'`,
      [scope.productId, scope.storeId],
    )
    return Object.freeze({ conflict: true })
  }
  // Neither a retry nor a fresh proof can clear a conflict/revocation hold.
  if (previous.state !== 'pending') return Object.freeze({ conflict: true })
  if (previous.token_revision !== scope.tokenRevision) {
    // A NEW independently verified OAuth proof is required after rotation.
    // The guard has checked this revision under a PostgreSQL row lock.
    await client.query(
      `UPDATE admin_evotor_store_bindings
       SET token_revision=$3::bigint,updated_at=NOW()
       WHERE product_id=$1::uuid AND store_id=$2 AND state='pending'`,
      [scope.productId, scope.storeId, scope.tokenRevision],
    )
  }
  return Object.freeze({ state: 'pending', created: false })
}

export async function bindEvotorStoreWithOwnerProof({
  database, proof, signingKey, expected, sessionTokenHash,
  providerToken, consumeNonce, fetchImpl,
}: {
  database: Pick<Pool, 'connect' | 'query'>
  proof: string
  signingKey: Buffer
  expected: EvotorOwnerProofScope
  sessionTokenHash: string
  providerToken: string
  consumeNonce: (nonce: string, expiresAt: number) => Promise<boolean>
  fetchImpl?: typeof fetch
}): Promise<BindingResult> {
  const result = await withEvotorOwnerBindingGuard({
    database, proof, signingKey, expected, sessionTokenHash,
    providerToken, consumeNonce, fetchImpl,
    onVerified: client => persistInsideVerifiedTransaction(client, expected),
  })
  if ('conflict' in result) throw new EvotorStoreBindingError()
  return result
}

export type EvotorBindingStatus = 'pending' | 'hold' | 'revoked' | 'disconnected'

/**
 * Scoped diagnostic ONLY; NEVER use it as a license/CRM/POS authorization.
 * Unauthorized or missing rows return null (not a foreign store's identity).
 * Token rotation, uninstall or reconciliation hold returns disconnected.
 * No code path here can turn a pending binding into ready.
 */
export async function readEvotorStoreBindingStatus({
  database, productId, storeId, companyId, venueId, actorId, sessionTokenHash,
}: {
  database: Pick<Pool, 'query'>
  productId: string; storeId: string; companyId: string; venueId: string
  actorId: string; sessionTokenHash: string
}): Promise<EvotorBindingStatus | null> {
  if (!database || typeof database.query !== 'function'
    || !uuid.test(productId) || !store.test(storeId)
    || !id(companyId) || !id(venueId) || !id(actorId)
    || !session.test(sessionTokenHash)) return null
  const row = await database.query<{state: string; connected: boolean}>(
    `SELECT b.state,
      (u.installation_state='installed' AND u.reconciliation_required=FALSE
        AND u.secret_ciphertext IS NOT NULL
        AND u.token_revision=b.token_revision) AS connected
     FROM admin_evotor_store_bindings b
     JOIN companies c ON c.id=b.company_id AND c.active=TRUE
     JOIN venues v ON v.id=b.venue_id AND v.company_id=c.id AND v.active=TRUE
     JOIN admin_company_access g ON g.company_id=c.id
       AND g.admin_id=$5::bigint AND g.access_kind='owner'
     JOIN admin_accounts a ON a.id=g.admin_id AND a.active=TRUE
     JOIN admin_sessions s ON s.admin_id=a.id
       AND s.token_hash=$6 AND s.expires_at>clock_timestamp()
     LEFT JOIN admin_evotor_market_users u
       ON u.product_id=b.product_id AND u.user_id=b.provider_user_id
     WHERE b.product_id=$1::uuid AND b.store_id=$2
       AND b.company_id=$3::bigint AND b.venue_id=$4::bigint`,
    [productId, storeId, companyId, venueId, actorId, sessionTokenHash],
  )
  if (row.rowCount !== 1) return null
  const state = row.rows[0]!.state
  if (state === 'hold' || state === 'revoked') return state
  return row.rows[0]!.connected === true ? 'pending' : 'disconnected'
}
