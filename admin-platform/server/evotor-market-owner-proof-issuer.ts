/**
 * UNMOUNTED P0.2 server-only issuer. An OAuth authorization code is NOT an
 * Evotor identity by itself. This flow consumes a durable SPACEVERSE session
 * state, exchanges the code server-side, verifies ALL provider stores against
 * an installed callback identity, then locks canonical grants and revision
 * before issuing a short-lived one-time binding prerequisite.
 *
 * No HTTP route, tenant activation, token persistence, license or POS writes.
 * Keep unmounted until the official provider callback demonstrably echoes
 * state and a real test owner completes the authorization flow.
 */
import { createHmac, randomBytes } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { consumeEvotorOAuthState } from './evotor-market-oauth-state.js'
import { exchangeEvotorAuthorizationCode } from './evotor-market-oauth-exchange.js'
import { verifyEvotorMarketStoresAtRevision } from './evotor-market-stores.js'

const purpose = 'spaceverse.evotor.store-owner-binding.v1'
const maxBigint = 9223372036854775807n
const productPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const storePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const validProviderId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 128
  && !Array.from(value).some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)

export class EvotorOwnerProofIssueError extends Error {
  readonly code: 'EVOTOR_OWNER_ISSUE_DENIED' | 'EVOTOR_OWNER_ISSUE_UNAVAILABLE'
  readonly statusCode: 403 | 503
  constructor(code: 'EVOTOR_OWNER_ISSUE_DENIED' | 'EVOTOR_OWNER_ISSUE_UNAVAILABLE') {
    super('Не удалось подтвердить право на подключение магазина Эвотора.')
    this.code = code
    this.statusCode = code === 'EVOTOR_OWNER_ISSUE_DENIED' ? 403 : 503
  }
}
const denied = () => new EvotorOwnerProofIssueError('EVOTOR_OWNER_ISSUE_DENIED')
const unavailable = () => new EvotorOwnerProofIssueError('EVOTOR_OWNER_ISSUE_UNAVAILABLE')
const revisionValid = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value)
  && BigInt(value) <= maxBigint

/**
 * expectedProviderUserId MUST be selected from server-verified installation
 * context. It is a lookup hint, never ownership evidence: both the complete
 * OAuth-token GET /stores and current callback installation must match it.
 * selectedStoreId is only a choice, never authority.
 *
 * All OAuth credentials, product ID, callback URI, signing key and current
 * session hash MUST originate from server configuration/authentication.
 */
export async function issueEvotorOwnerProofFromOAuth({
  database, state, sessionTokenHash, productId, redirectUri, code,
  clientId, clientSecret, expectedProviderUserId, selectedStoreId,
  signingKey, fetchImpl,
}: {
  database: Pick<Pool, 'query' | 'connect'>
  state: string
  sessionTokenHash: string
  productId: string
  redirectUri: string
  code: string
  clientId: string
  clientSecret: string
  expectedProviderUserId: string
  selectedStoreId: string
  signingKey: Buffer
  fetchImpl?: typeof fetch
}): Promise<Readonly<{ proof: string }>> {
  if (!database || typeof database.query !== 'function' || typeof database.connect !== 'function'
    || typeof productId !== 'string' || !productPattern.test(productId)
    || !validProviderId(expectedProviderUserId)
    || typeof selectedStoreId !== 'string' || !storePattern.test(selectedStoreId)
    || !Buffer.isBuffer(signingKey) || signingKey.length < 32) throw denied()

  // Consume exactly one server-authenticated session state. Failed exchange
  // cannot reuse it. No caller-provided canonical company/venue is accepted.
  let scope: Awaited<ReturnType<typeof consumeEvotorOAuthState>>
  try {
    scope = await consumeEvotorOAuthState({
      database, state, sessionTokenHash, productId, redirectUri,
    })
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error
      && error.statusCode === 403) throw denied()
    throw unavailable()
  }

  let token: Awaited<ReturnType<typeof exchangeEvotorAuthorizationCode>>
  try {
    token = await exchangeEvotorAuthorizationCode({
      code, clientId, clientSecret, redirectUri, fetchImpl,
    })
  } catch { throw unavailable() }

  const readRevision = async (): Promise<string | null> => {
    const row = await database.query<{ token_revision: string }>(
      [
        'SELECT token_revision::text FROM admin_evotor_market_users',
        'WHERE product_id=$1::uuid AND user_id=$2',
        "AND installation_state='installed' AND reconciliation_required=FALSE",
        'AND secret_ciphertext IS NOT NULL AND token_revision>0',
      ].join(' '),
      [scope.productId, expectedProviderUserId],
    )
    const revision = row.rows[0]?.token_revision
    return revisionValid(revision) ? revision : null
  }
  let revision: string | null
  try { revision = await readRevision() } catch { throw unavailable() }
  if (!revision) throw denied()

  let stores: Awaited<ReturnType<typeof verifyEvotorMarketStoresAtRevision>>
  try {
    stores = await verifyEvotorMarketStoresAtRevision({
      token: token.accessToken, expectedUserId: expectedProviderUserId,
      expectedTokenRevision: revision, readCurrentTokenRevision: readRevision, fetchImpl,
    })
  } catch { throw unavailable() }
  if (!stores.some(store => store.storeId === selectedStoreId
    && store.userId === expectedProviderUserId)) throw denied()

  let client: PoolClient
  try { client = await database.connect() } catch { throw unavailable() }
  let begun = false
  try {
    await client.query('BEGIN')
    begun = true
    // The final SQL check locks all relevant primary-DB rows until COMMIT.
    // It rejects a revoked owner, switched venue, expired session, rotated
    // credential or reconciliation hold occurring during the provider GET.
    const result = await client.query<{ token_revision: string }>(
      [
        'SELECT u.token_revision::text FROM admin_accounts a',
        'JOIN admin_sessions s ON s.admin_id=a.id',
        'JOIN admin_company_access g ON g.admin_id=a.id',
        'JOIN companies c ON c.id=g.company_id',
        'JOIN venues v ON v.company_id=c.id',
        'JOIN admin_evotor_market_users u ON u.product_id=$6::uuid AND u.user_id=$7',
        'WHERE a.id=$1::bigint AND a.active=TRUE',
        'AND s.token_hash=$2 AND s.expires_at>clock_timestamp()',
        "AND g.access_kind='owner' AND c.id=$3::bigint AND c.active=TRUE",
        'AND v.id=$4::bigint AND v.company_id=c.id AND v.active=TRUE',
        "AND u.installation_state='installed' AND u.reconciliation_required=FALSE",
        'AND u.secret_ciphertext IS NOT NULL AND u.token_revision=$5::bigint',
        'FOR SHARE OF a,s,g,c,v,u',
      ].join(' '),
      [scope.spaceverseUserId, scope.sessionId, scope.companyId, scope.venueId,
        revision, scope.productId, expectedProviderUserId],
    )
    if (result.rowCount !== 1 || result.rows[0]?.token_revision !== revision) throw denied()

    const issuedAt = Date.now()
    const expiresAt = issuedAt + Math.min(300_000, token.expiresInSeconds * 1000)
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= issuedAt) throw denied()
    const claim = {
      purpose, nonce: randomBytes(32).toString('base64url'),
      spaceverseUserId: scope.spaceverseUserId, sessionId: scope.sessionId,
      providerUserId: expectedProviderUserId, productId: scope.productId,
      companyId: scope.companyId, venueId: scope.venueId,
      storeId: selectedStoreId, tokenRevision: revision,
      issuedAt, expiresAt,
    }
    const encoded = Buffer.from(JSON.stringify(claim)).toString('base64url')
    const mac = createHmac('sha256', signingKey).update(purpose + '\n' + encoded).digest('base64url')
    await client.query('COMMIT')
    begun = false
    return Object.freeze({ proof: encoded + '.' + mac })
  } catch (error) {
    if (begun) await client.query('ROLLBACK').catch(() => undefined)
    if (error instanceof EvotorOwnerProofIssueError) throw error
    throw unavailable()
  } finally { client.release() }
}
