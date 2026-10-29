/**
 * Unmounted, fail-closed durable nonce consumer for the internal owner proof.
 * This proves one-time use only, NOT Evotor ownership or tenant permissions.
 * Do not attach to HTTP routes before independent provider identity verification.
 */
import { createHash } from 'node:crypto'
import type { Pool } from 'pg'

const purpose = 'spaceverse.evotor.store-owner-binding.v1'
const keyIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const noncePattern = /^[A-Za-z0-9_-]{22,128}$/

export class EvotorOwnerNonceError extends Error {
  readonly code = 'EVOTOR_OWNER_NONCE_UNAVAILABLE'
  constructor() { super('Cannot safely consume Evotor owner proof nonce.') }
}

/**
 * Requires manual migration 022 on the primary Admin DB. A single INSERT is
 * an autocommitted, atomic claim: only one concurrent caller can get true.
 * Use only as an unmounted prerequisite; final binding must recheck all grants
 * and token revision in its own atomic transaction.
 */
export function createEvotorOwnerNonceConsumer(database: Pick<Pool, 'query'>, signingKeyId: string) {
  if (!database || typeof database.query !== 'function' || typeof signingKeyId !== 'string'
    || !keyIdPattern.test(signingKeyId))
    throw new EvotorOwnerNonceError()
  return async (nonce: string, expiresAt: number): Promise<boolean> => {
    if (typeof nonce !== 'string' || !noncePattern.test(nonce)
      || !Number.isSafeInteger(expiresAt) || expiresAt <= 0 || expiresAt > 8_640_000_000_000_000)
      throw new EvotorOwnerNonceError()
    const hash = createHash('sha256').update(nonce, 'utf8').digest()
    try {
      const result = await database.query(
        `INSERT INTO admin_evotor_owner_proof_nonces
           (purpose, signing_key_id, nonce_hash, expires_at)
         SELECT $1, $2, $3::bytea, $4::timestamptz
         WHERE $4::timestamptz > NOW()
         ON CONFLICT DO NOTHING RETURNING nonce_hash`,
        [purpose, signingKeyId, hash, new Date(expiresAt)],
      )
      return result.rowCount === 1
    } catch {
      throw new EvotorOwnerNonceError()
    }
  }
}
