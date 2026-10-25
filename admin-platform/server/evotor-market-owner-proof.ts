/**
 * Unmounted, server-only one-time binding prerequisite. A valid signature proves
 * only that a trusted SPACEVERSE issuer produced the claim. It DOES NOT prove
 * Evotor ownership: issuance must follow independent provider authentication,
 * and binding must recheck canonical grants, installation and token revision
 * inside its own transaction. Never expose a signing endpoint to the browser.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

const purpose = 'spaceverse.evotor.store-owner-binding.v1'
const maxTtlMs = 5 * 60_000
const maxTokenLength = 6_000
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const noncePattern = /^[A-Za-z0-9_-]{22,128}$/
const revisionPattern = /^[1-9]\d{0,18}$/
const expectedFields = ['purpose', 'nonce', 'spaceverseUserId', 'sessionId', 'providerUserId',
  'productId', 'companyId', 'storeId', 'tokenRevision', 'issuedAt', 'expiresAt'] as const

type OwnerProofField = (typeof expectedFields)[number]
export interface EvotorOwnerProofScope {
  readonly spaceverseUserId: string
  readonly sessionId: string
  readonly providerUserId: string
  readonly productId: string
  readonly companyId: string
  readonly storeId: string
  readonly tokenRevision: string
}
export interface EvotorOwnerProofClaims extends EvotorOwnerProofScope {
  readonly purpose: typeof purpose
  readonly nonce: string
  readonly issuedAt: number
  readonly expiresAt: number
}

export class EvotorOwnerProofError extends Error {
  readonly code = 'EVOTOR_OWNER_PROOF_INVALID'
  readonly statusCode = 403
  constructor() { super('Не удалось подтвердить право на привязку магазина Эвотора.') }
}
const denied = (): never => { throw new EvotorOwnerProofError() }
function validId(value: unknown): value is string {
  return typeof value === 'string' && idPattern.test(value)
}
function validRevision(value: unknown): value is string {
  return typeof value === 'string' && revisionPattern.test(value)
    && BigInt(value) <= 9223372036854775807n
}
function parseCanonicalBase64url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return denied()
  const decoded = Buffer.from(value, 'base64url')
  if (decoded.toString('base64url') !== value) return denied()
  return decoded
}

/**
 * consumeNonce MUST be an atomic, durable insert-if-absent in the primary DB,
 * scoped to the purpose and signing key, with unique constraint on nonce.
 * A process-local Set or a read-then-insert is NOT acceptable in production.
 * Return true only after commit. DB errors must reject or return false.
 */
export async function verifyEvotorOwnerProofOnce({
  proof, signingKey, expected, consumeNonce, now = Date.now(),
}: {
  proof: string
  signingKey: Buffer
  expected: EvotorOwnerProofScope
  consumeNonce: (nonce: string, expiresAt: number) => Promise<boolean>
  now?: number
}): Promise<Readonly<EvotorOwnerProofClaims>> {
  if (typeof proof !== 'string' || proof.length > maxTokenLength || proof.length < 44
    || !Buffer.isBuffer(signingKey) || signingKey.length < 32
    || typeof consumeNonce !== 'function' || !Number.isSafeInteger(now) || now < 0
    || !expected || typeof expected !== 'object') return denied()
  const parts = proof.split('.')
  if (parts.length !== 2) return denied()
  const [encoded, mac] = parts
  const providedMac = parseCanonicalBase64url(mac)
  if (providedMac.length !== 32) return denied()
  const calculatedMac = createHmac('sha256', signingKey).update(purpose + '\n' + encoded).digest()
  if (!timingSafeEqual(providedMac, calculatedMac)) return denied()
  const bytes = parseCanonicalBase64url(encoded)
  if (bytes.length > 4_096) return denied()
  let claim: Record<string, unknown>
  try {
    claim = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch { return denied() }
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)
    || Object.keys(claim).length !== expectedFields.length
    || Object.keys(claim).some(key => !expectedFields.includes(key as OwnerProofField))
    || claim.purpose !== purpose || typeof claim.nonce !== 'string' || !noncePattern.test(claim.nonce)
    || !Number.isSafeInteger(claim.issuedAt as number) || !Number.isSafeInteger(claim.expiresAt as number)) return denied()
  const issuedAt = claim.issuedAt as number, expiresAt = claim.expiresAt as number
  if (issuedAt > now || expiresAt <= now || expiresAt <= issuedAt
    || expiresAt - issuedAt > maxTtlMs) return denied()
  for (const field of ['spaceverseUserId', 'sessionId', 'providerUserId', 'productId', 'companyId', 'storeId'] as const) {
    if (!validId(expected[field]) || !validId(claim[field]) || claim[field] !== expected[field]) return denied()
  }
  if (!validRevision(expected.tokenRevision) || claim.tokenRevision !== expected.tokenRevision) return denied()
  // No permission is granted here. Only the one-time claim is consumed.
  // An atomic binding transaction must independently check provider and tenant state.
  let consumed = false
  try { consumed = await consumeNonce(claim.nonce as string, expiresAt) }
  catch { return denied() }
  if (consumed !== true) return denied()
  return Object.freeze(claim as unknown as EvotorOwnerProofClaims)
}
