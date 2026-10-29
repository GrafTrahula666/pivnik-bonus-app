// @vitest-environment node
// Synthetic signed license evidence ONLY. No real Evotor contract or issuer.
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { evaluateEvotorLicensePolicy } from '../evotor-market-license-policy.js'
import type { EvotorLicenseScope } from '../evotor-market-license-policy.js'

const now = Date.UTC(2026, 9, 26, 5, 0, 0)
const key = Buffer.alloc(32, 81)
const scope: EvotorLicenseScope = {
  productId: 'c0d01535-5193-4cc2-9bfb-be20e0679498',
  providerUserId: 'verified-provider-1',
  subscriptionId: 'f1d01535-5193-4cc2-9bfb-be20e0679498',
  companyId: '12', venueId: '33', storeId: 'store-1',
}
const baseline = () => ({
  scope: { ...scope },
  snapshot: {
    installation: {
      productId: scope.productId, providerUserId: scope.providerUserId,
      state: 'installed', tokenRevision: '2', hasEncryptedToken: true,
      reconciliationRequired: false,
    },
    subscription: {
      productId: scope.productId, providerUserId: scope.providerUserId,
      subscriptionId: scope.subscriptionId, state: 'active',
      hasSequenceGap: false, reconciliationRequired: false,
      lastSequence: '3', paidUntilMs: now + 120_000, planId: 'approved-plan',
    },
    binding: {
      productId: scope.productId, providerUserId: scope.providerUserId,
      companyId: scope.companyId, venueId: scope.venueId,
      storeId: scope.storeId, tokenRevision: '2', state: 'ready',
    },
  },
  policy: {
    approved: true, unit: 'venue' as 'company' | 'venue' | 'terminal', planIds: ['approved-plan'],
    allowTrial: false, allowGrace: false, maxProofAgeMs: 120_000,
  },
  proof: {
    purpose: 'spaceverse.evotor.license.v1',
    issuer: 'trusted-provider-license-verifier',
    ...scope, tokenRevision: '2', planId: 'approved-plan',
    unit: 'venue', status: 'active', terminalId: undefined as string | undefined,
    verifiedAtMs: now - 10_000,
    expiresAtMs: now + 60_000,
  },
})
const sign = (claim: unknown, signingKey = key) => {
  const encoded = Buffer.from(JSON.stringify(claim)).toString('base64url')
  const mac = createHmac('sha256', signingKey)
    .update('spaceverse.evotor.license.v1\n' + encoded).digest('base64url')
  return encoded + '.' + mac
}
const evaluate = (change?: (input: ReturnType<typeof baseline>) => void) => {
  const input = baseline()
  change?.(input)
  return evaluateEvotorLicensePolicy({
    scope: input.scope,
    snapshot: input.snapshot,
    policy: input.policy,
    signedEntitlement: sign(input.proof),
    signingKey: key,
    nowMs: now,
  })
}

describe('Evotor unmounted signed license policy / fail closed', () => {
  it('accepts only a complete synthetic approved proof and ready scope', () => {
    expect(evaluate()).toBe(true)
  })
  it('does not turn an active callback or pending binding into a paid license', () => {
    expect(evaluate(input => { input.snapshot.binding.state = 'pending' })).toBe(false)
    expect(evaluate(input => { input.policy.approved = false })).toBe(false)
  })
  it('rejects missing official plan approval and incompatible license unit', () => {
    expect(evaluate(input => { input.policy.planIds = ['other-plan'] })).toBe(false)
    expect(evaluate(input => { input.policy.unit = 'company' })).toBe(false)
  })
  it('denies provider uninstall, missing secret and reconciliation holds', () => {
    expect(evaluate(input => { input.snapshot.installation.state = 'uninstalled' })).toBe(false)
    expect(evaluate(input => { input.snapshot.installation.hasEncryptedToken = false })).toBe(false)
    expect(evaluate(input => { input.snapshot.installation.reconciliationRequired = true })).toBe(false)
    expect(evaluate(input => { input.snapshot.subscription.reconciliationRequired = true })).toBe(false)
  })
  it('denies sequence gaps, terminal subscriptions and missing period', () => {
    expect(evaluate(input => { input.snapshot.subscription.hasSequenceGap = true })).toBe(false)
    expect(evaluate(input => { input.snapshot.subscription.state = 'terminated' })).toBe(false)
    expect(evaluate(input => { input.snapshot.subscription.paidUntilMs = now })).toBe(false)
    expect(evaluate(input => { input.snapshot.subscription.lastSequence = '0' })).toBe(false)
  })
  it('denies stale token revisions, held binding and missing exact plan', () => {
    expect(evaluate(input => { input.snapshot.binding.tokenRevision = '1' })).toBe(false)
    expect(evaluate(input => { input.snapshot.binding.state = 'hold' })).toBe(false)
    expect(evaluate(input => { input.proof.tokenRevision = '1' })).toBe(false)
    expect(evaluate(input => { input.snapshot.subscription.planId = 'other-plan' })).toBe(false)
  })
  it('denies cross-company, venue, store, provider and subscription substitution', () => {
    expect(evaluate(input => { input.scope.companyId = '44' })).toBe(false)
    expect(evaluate(input => { input.scope.venueId = '44' })).toBe(false)
    expect(evaluate(input => { input.scope.storeId = 'other-store' })).toBe(false)
    expect(evaluate(input => { input.scope.providerUserId = 'other-provider' })).toBe(false)
    expect(evaluate(input => { input.scope.subscriptionId = 'other-subscription' })).toBe(false)
  })
  it('denies expired, future-issued or overlong signed evidence', () => {
    expect(evaluate(input => { input.proof.expiresAtMs = now })).toBe(false)
    expect(evaluate(input => { input.proof.verifiedAtMs = now + 1 })).toBe(false)
    expect(evaluate(input => { input.proof.verifiedAtMs = now - 130_000 })).toBe(false)
    expect(evaluate(input => { input.proof.expiresAtMs = now + 200_000 })).toBe(false)
  })
  it('denies trial/grace without an explicit approved policy', () => {
    expect(evaluate(input => { input.proof.status = 'trial' })).toBe(false)
    expect(evaluate(input => { input.proof.status = 'grace' })).toBe(false)
    expect(evaluate(input => { input.proof.status = 'trial'; input.policy.allowTrial = true })).toBe(true)
    expect(evaluate(input => { input.proof.status = 'grace'; input.policy.allowGrace = true })).toBe(true)
  })
  it('denies unsigned, tampered and wrong-key evidence', () => {
    const input = baseline()
    const signed = sign(input.proof)
    const [encoded, mac] = signed.split('.')
    const tampered = Buffer.from(JSON.stringify({ ...input.proof, venueId: '99' })).toString('base64url')
    const common = {
      scope: input.scope, snapshot: input.snapshot, policy: input.policy,
      signingKey: key, nowMs: now,
    }
    expect(evaluateEvotorLicensePolicy({ ...common, signedEntitlement: tampered + '.' + mac })).toBe(false)
    expect(evaluateEvotorLicensePolicy({ ...common, signedEntitlement: encoded + '.' + 'A'.repeat(43) })).toBe(false)
    expect(evaluateEvotorLicensePolicy({ ...common, signedEntitlement: sign(input.proof, Buffer.alloc(32, 82)) })).toBe(false)
    expect(evaluateEvotorLicensePolicy({ ...common, signedEntitlement: signed, signingKey: Buffer.alloc(12) })).toBe(false)
  })
  it('denies terminal scope widening without an exact terminal identity', () => {
    expect(evaluate(input => { input.scope.terminalId = 'other-terminal' })).toBe(false)
    expect(evaluate(input => { input.policy.unit = 'terminal'; input.proof.unit = 'terminal' })).toBe(false)
    expect(evaluate(input => {
      input.policy.unit = 'terminal'; input.proof.unit = 'terminal'
      input.scope.terminalId = 'terminal-1'; input.proof.terminalId = 'terminal-1'
    })).toBe(true)
  })
  it('denies unapproved or malformed verification provenance', () => {
    expect(evaluate(input => { input.proof.issuer = 'browser' })).toBe(false)
    expect(evaluate(input => { input.proof.purpose = 'different-purpose' })).toBe(false)
    expect(evaluate(input => { input.proof.status = 'refund' })).toBe(false)
  })
})
