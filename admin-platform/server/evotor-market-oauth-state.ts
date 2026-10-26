/**
 * UNMOUNTED P0.2 OAuth CSRF prerequisite. The state is random, stored only as
 * SHA-256, durable across workers, single-use, bound to a live SPACEVERSE
 * session + canonical owner/company/venue + server-configured OAuth callback.
 * It does NOT authenticate an Evotor user, authorize a store, issue a signed
 * owner proof, create a binding or grant a license. No browser-supplied scope
 * or OAuth credentials may be treated as trusted server configuration.
 *
 * Requires manual Admin migration 023; never run it at startup.
 */
import { createHash, randomBytes } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'

const statePattern = /^[A-Za-z0-9_-]{43}$/
const sessionPattern = /^[0-9a-f]{64}$/
const productPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const maxBigint = 9223372036854775807n

export class EvotorOAuthStateError extends Error {
  readonly code: 'EVOTOR_OAUTH_STATE_DENIED' | 'EVOTOR_OAUTH_STATE_UNAVAILABLE'
  readonly statusCode: 403 | 503
  constructor(code: 'EVOTOR_OAUTH_STATE_DENIED' | 'EVOTOR_OAUTH_STATE_UNAVAILABLE') {
    super('Не удалось подтвердить сессию подключения Эвотора.')
    this.code = code
    this.statusCode = code === 'EVOTOR_OAUTH_STATE_DENIED' ? 403 : 503
  }
}
const denied = () => new EvotorOAuthStateError('EVOTOR_OAUTH_STATE_DENIED')
const unavailable = () => new EvotorOAuthStateError('EVOTOR_OAUTH_STATE_UNAVAILABLE')
const positiveId = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9]\\d{0,18}$/.test(value) && BigInt(value) <= maxBigint

function validRedirect(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 2048) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password
      && !url.hash && url.href === value
  } catch { return false }
}
function hashState(state: string): Buffer {
  if (typeof state !== 'string' || !statePattern.test(state)) throw denied()
  const bytes = Buffer.from(state, 'base64url')
  if (bytes.length !== 32 || bytes.toString('base64url') !== state) throw denied()
  return createHash('sha256').update(bytes).digest()
}
function validateContext(context: {
  sessionTokenHash: string; productId: string; redirectUri: string
}): void {
  if (!context || !sessionPattern.test(context.sessionTokenHash)
    || !productPattern.test(context.productId) || !validRedirect(context.redirectUri))
    throw denied()
}
export interface EvotorOAuthStateScope {
  readonly spaceverseUserId: string
  readonly companyId: string
  readonly venueId: string
  readonly productId: string
  readonly sessionId: string
  readonly redirectUri: string
}

/** Only call with IDs/session hash resolved from authenticated server context. */
export async function issueEvotorOAuthState({
  database, spaceverseUserId, companyId, venueId, sessionTokenHash, productId, redirectUri,
}: {
  database: Pick<Pool, 'query'>
  spaceverseUserId: string
  companyId: string
  venueId: string
  sessionTokenHash: string
  productId: string
  redirectUri: string
}): Promise<Readonly<{ state: string }>> {
  validateContext({ sessionTokenHash, productId, redirectUri })
  if (!positiveId(spaceverseUserId) || !positiveId(companyId) || !positiveId(venueId)
    || !database || typeof database.query !== 'function') throw denied()
  const bytes = randomBytes(32)
  const state = bytes.toString('base64url')
  const digest = createHash('sha256').update(bytes).digest()
  try {
    // One statement: lock the authenticated session, owner grant and canonical
    // scope while issuing. Revocation after issue is rechecked on consumption.
    const result = await database.query(
      `WITH permitted AS (
         SELECT a.id FROM admin_accounts a
         JOIN admin_sessions s ON s.admin_id=a.id
         JOIN admin_company_access g ON g.admin_id=a.id
         JOIN companies c ON c.id=g.company_id
         JOIN venues v ON v.company_id=c.id
         WHERE a.id=$1::bigint AND a.active=TRUE
           AND s.token_hash=$2 AND s.expires_at>clock_timestamp()
           AND c.id=$3::bigint AND c.active=TRUE
           AND v.id=$4::bigint AND v.active=TRUE
           AND g.access_kind='owner'
         FOR SHARE OF a,s,g,c,v
       )
       INSERT INTO admin_evotor_oauth_states
         (state_hash,admin_id,session_token_hash,company_id,venue_id,
          product_id,redirect_uri,issued_at,expires_at)
       SELECT $5::bytea,$1::bigint,$2,$3::bigint,$4::bigint,
              $6::uuid,$7,clock_timestamp(),clock_timestamp()+INTERVAL '5 minutes'
       FROM permitted RETURNING state_hash`,
      [spaceverseUserId, sessionTokenHash, companyId, venueId, digest, productId, redirectUri],
    )
    if (result.rowCount !== 1) throw denied()
    return Object.freeze({ state })
  } catch (error) {
    if (error instanceof EvotorOAuthStateError) throw error
    throw unavailable()
  }
}

/**
 * Atomically consumes state only for the exact same current session, product
 * and redirect. A foreign session/callback does NOT burn another owner's state.
 * Returns the canonical scope stored at issuance, not browser-provided IDs.
 * Failed code exchange after this step requires a fresh state.
 */
export async function consumeEvotorOAuthState({
  database, state, sessionTokenHash, productId, redirectUri,
}: {
  database: Pick<Pool, 'connect'>
  state: string
  sessionTokenHash: string
  productId: string
  redirectUri: string
}): Promise<Readonly<EvotorOAuthStateScope>> {
  validateContext({ sessionTokenHash, productId, redirectUri })
  const digest = hashState(state)
  if (!database || typeof database.connect !== 'function') throw denied()
  let client: PoolClient
  try { client = await database.connect() }
  catch { throw unavailable() }
  let begun = false
  try {
    await client.query('BEGIN')
    begun = true
    // FOR UPDATE serializes simultaneous callbacks across processes.
    const found = await client.query<{
      admin_id: string; company_id: string; venue_id: string
    }>(
      `SELECT admin_id::text,company_id::text,venue_id::text
       FROM admin_evotor_oauth_states
       WHERE state_hash=$1::bytea AND session_token_hash=$2
         AND product_id=$3::uuid AND redirect_uri=$4
         AND consumed_at IS NULL AND expires_at>clock_timestamp()
       FOR UPDATE`,
      [digest, sessionTokenHash, productId, redirectUri],
    )
    if (found.rowCount !== 1) throw denied()
    const { admin_id: adminId, company_id: companyId, venue_id: venueId } = found.rows[0]!
    const checks: Array<[string, string[]]> = [
      [`SELECT id FROM admin_accounts WHERE id=$1::bigint AND active=TRUE FOR SHARE`, [adminId]],
      [`SELECT token_hash FROM admin_sessions
        WHERE token_hash=$1 AND admin_id=$2::bigint
          AND expires_at>clock_timestamp() FOR SHARE`, [sessionTokenHash, adminId]],
      [`SELECT id FROM companies WHERE id=$1::bigint AND active=TRUE FOR SHARE`, [companyId]],
      [`SELECT id FROM venues WHERE id=$1::bigint AND company_id=$2::bigint
        AND active=TRUE FOR SHARE`, [venueId, companyId]],
      [`SELECT admin_id FROM admin_company_access
        WHERE admin_id=$1::bigint AND company_id=$2::bigint
          AND access_kind='owner' FOR SHARE`, [adminId, companyId]],
    ]
    for (const [sql, params] of checks) {
      if ((await client.query(sql, params)).rowCount !== 1) throw denied()
    }
    const consumed = await client.query(
      `UPDATE admin_evotor_oauth_states SET consumed_at=clock_timestamp()
       WHERE state_hash=$1::bytea AND consumed_at IS NULL
         AND expires_at>clock_timestamp() RETURNING state_hash`,
      [digest],
    )
    if (consumed.rowCount !== 1) throw denied()
    await client.query('COMMIT')
    begun = false
    return Object.freeze({
      spaceverseUserId: adminId, companyId, venueId, productId,
      sessionId: sessionTokenHash, redirectUri,
    })
  } catch (error) {
    if (begun) await client.query('ROLLBACK').catch(() => undefined)
    if (error instanceof EvotorOAuthStateError) throw error
    throw unavailable()
  } finally { client.release() }
}
