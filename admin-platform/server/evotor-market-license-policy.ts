/**
 * UNMOUNTED P0.4 license policy. This module cannot issue an entitlement.
 * An independently verified provider/license contract must sign the evidence
 * server-side. NEVER sign callback projections or browser-supplied fields.
 * No HTTP route, license issuer, billing, tenant activation or POS access.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export interface EvotorLicenseScope {
  productId: string
  providerUserId: string
  subscriptionId: string
  companyId: string
  venueId: string
  storeId: string
  terminalId?: string
}

export interface EvotorLicenseSnapshot {
  installation: {
    productId: string; providerUserId: string; state: string
    tokenRevision: string; hasEncryptedToken: boolean; reconciliationRequired: boolean
  }
  subscription: {
    productId: string; providerUserId: string; subscriptionId: string
    state: string; hasSequenceGap: boolean; reconciliationRequired: boolean
    lastSequence: string; paidUntilMs: number | null; planId: string | null
  }
  binding: {
    productId: string; providerUserId: string; companyId: string; venueId: string
    storeId: string; tokenRevision: string; state: string
  }
}

export interface EvotorApprovedLicensePolicy {
  // Must be supplied by a server-owned configuration AFTER the official
  // licensing unit and commercial terms have been confirmed.
  approved: boolean
  unit: 'company' | 'venue' | 'terminal'
  planIds: readonly string[]
  allowTrial: boolean
  allowGrace: boolean
  maxProofAgeMs: number
}

interface SignedEntitlement {
  purpose: 'spaceverse.evotor.license.v1'
  issuer: 'trusted-provider-license-verifier'
  productId: string; providerUserId: string; subscriptionId: string
  companyId: string; venueId: string; storeId: string; terminalId?: string
  tokenRevision: string; planId: string
  unit: 'company' | 'venue' | 'terminal'
  status: 'active' | 'trial' | 'grace'
  verifiedAtMs: number; expiresAtMs: number
}

const purpose = 'spaceverse.evotor.license.v1'
const digits = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value)
  && BigInt(value) <= 9223372036854775807n
const same = (a: unknown, b: unknown) =>
  typeof a === 'string' && a.length > 0 && a === b

/** A signed proof is a prerequisite, not an issuer or a substitute for DB scope. */
function decodeSignedEntitlement(raw: string, signingKey: Buffer): SignedEntitlement | null {
  if (!Buffer.isBuffer(signingKey) || signingKey.length < 32
    || typeof raw !== 'string' || raw.length > 4096) return null
  const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(raw)
  if (!match) return null
  const [encoded, mac] = [match[1]!, match[2]!]
  try {
    const payload = Buffer.from(encoded, 'base64url')
    if (payload.toString('base64url') !== encoded || payload.length > 2048) return null
    const signature = Buffer.from(mac, 'base64url')
    if (signature.toString('base64url') !== mac || signature.length !== 32) return null
    const expected = createHmac('sha256', signingKey).update(purpose + '\n' + encoded).digest()
    if (!timingSafeEqual(expected, signature)) return null
    const claim: unknown = JSON.parse(payload.toString('utf8'))
    if (!claim || typeof claim !== 'object' || Array.isArray(claim)) return null
    return claim as SignedEntitlement
  } catch { return null }
}

/**
 * Pure, fail-closed evaluation of server-owned evidence. No live authorization
 * exists until a trusted issuer, canonical DB reader and approved license unit
 * are wired. Never accept any of these arguments from an HTTP request body.
 */
export function evaluateEvotorLicensePolicy({
  scope, snapshot, policy, signedEntitlement, signingKey, nowMs = Date.now(),
}: {
  scope: EvotorLicenseScope
  snapshot: EvotorLicenseSnapshot
  policy: EvotorApprovedLicensePolicy | null
  signedEntitlement: string
  signingKey: Buffer
  nowMs?: number
}): boolean {
  if (!scope || !snapshot || !policy || policy.approved !== true
    || !['company', 'venue', 'terminal'].includes(policy.unit)
    || !Array.isArray(policy.planIds) || policy.planIds.length === 0
    || !Number.isSafeInteger(policy.maxProofAgeMs)
    || policy.maxProofAgeMs < 1 || policy.maxProofAgeMs > 300_000
    || !Number.isSafeInteger(nowMs) || nowMs < 1) return false
  const proof = decodeSignedEntitlement(signedEntitlement, signingKey)
  if (!proof || proof.purpose !== purpose
    || proof.issuer !== 'trusted-provider-license-verifier'
    || proof.unit !== policy.unit || !['active', 'trial', 'grace'].includes(proof.status)
    || (proof.status === 'trial' && policy.allowTrial !== true)
    || (proof.status === 'grace' && policy.allowGrace !== true)
    || !Number.isSafeInteger(proof.verifiedAtMs)
    || !Number.isSafeInteger(proof.expiresAtMs)
    || proof.verifiedAtMs > nowMs || proof.verifiedAtMs < nowMs - policy.maxProofAgeMs
    || proof.expiresAtMs <= nowMs
    || proof.expiresAtMs > proof.verifiedAtMs + policy.maxProofAgeMs) return false

  const { installation: u, subscription: s, binding: b } = snapshot
  if (!u || !s || !b || !digits(u.tokenRevision)
    || !digits(b.tokenRevision) || !digits(s.lastSequence)
    || u.state !== 'installed' || !u.hasEncryptedToken || u.reconciliationRequired
    || s.state !== 'active' || s.hasSequenceGap || s.reconciliationRequired
    || !Number.isFinite(s.paidUntilMs) || (s.paidUntilMs ?? 0) <= nowMs
    || !s.planId || !policy.planIds.includes(s.planId)
    // Current migration 024 only permits pending/hold/revoked. Therefore no
    // present database row can pass this readiness check. Deliberate default deny.
    || b.state !== 'ready'
    || u.tokenRevision !== b.tokenRevision || proof.tokenRevision !== u.tokenRevision
    || proof.planId !== s.planId) return false

  for (const key of ['productId', 'providerUserId'] as const) {
    if (!same(scope[key], u[key]) || !same(scope[key], s[key])
      || !same(scope[key], b[key]) || !same(scope[key], proof[key])) return false
  }
  if (!same(scope.subscriptionId, s.subscriptionId)
    || !same(scope.subscriptionId, proof.subscriptionId)) return false
  for (const key of ['companyId', 'venueId', 'storeId'] as const) {
    if (!same(scope[key], b[key]) || !same(scope[key], proof[key])) return false
  }
  // A license never widens a store/terminal binding. Terminal-scoped access
  // additionally requires the exact independently verified terminal ID.
  if (scope.terminalId !== proof.terminalId
    || (policy.unit === 'terminal' && !scope.terminalId)) return false
  return true
}
