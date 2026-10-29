// @vitest-environment node
// Synthetic, unmounted proof verifier contract. Not provider E2E or native DB.
import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { verifyEvotorOwnerProofOnce } from '../evotor-market-owner-proof.js'

const now = Date.UTC(2026, 9, 25, 17, 0)
const key = Buffer.alloc(32, 17)
const scope = Object.freeze({
  spaceverseUserId: 'owner-1', sessionId: 'session-1', providerUserId: '01-000000000000001',
  productId: 'c0d01535-5193-4cc2-9bfb-be20e0679498', companyId: 'company-1', venueId: 'venue-1',
  storeId: '20170228-F4F1-401B-80FA-9ECCA8451FFB', tokenRevision: '9223372036854775807',
})
const claim = (overrides: Record<string, unknown> = {}) => ({
  purpose: 'spaceverse.evotor.store-owner-binding.v1',
  nonce: 'AAAAAAAAAAAAAAAAAAAAAA', ...scope, issuedAt: now - 1_000,
  expiresAt: now + 60_000, ...overrides,
})
const sign = (payload: Record<string, unknown>, signingKey = key) => {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const mac = createHmac('sha256', signingKey)
    .update('spaceverse.evotor.store-owner-binding.v1\n' + encoded).digest('base64url')
  return encoded + '.' + mac
}
const fresh = () => {
  const consumed = new Set<string>()
  const consumeNonce = vi.fn(async (nonce: string) => {
    if (consumed.has(nonce)) return false
    consumed.add(nonce)
    return true
  })
  return { consumeNonce }
}
const verify = (proof: string, consumeNonce: (nonce: string, expiresAt: number) => Promise<boolean>,
  expected = scope, time = now, signingKey = key) =>
  verifyEvotorOwnerProofOnce({ proof, signingKey, expected, consumeNonce, now: time })
const invalid = { code: 'EVOTOR_OWNER_PROOF_INVALID', statusCode: 403 }

describe('Evotor owner binding one-time claim prerequisite (unmounted)', () => {
  it('accepts exact signed scope once and returns frozen claims', async () => {
    const { consumeNonce } = fresh()
    const result = await verify(sign(claim()), consumeNonce)
    expect(result.storeId).toBe(scope.storeId)
    expect(Object.isFrozen(result)).toBe(true)
    expect(consumeNonce).toHaveBeenCalledOnce()
    await expect(verify(sign(claim()), consumeNonce)).rejects.toMatchObject(invalid)
  })
  it('rejects two concurrent attempts at the same nonce', async () => {
    const { consumeNonce } = fresh()
    const results = await Promise.allSettled([verify(sign(claim()), consumeNonce), verify(sign(claim()), consumeNonce)])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1)
  })
  it.each(['spaceverseUserId', 'sessionId', 'providerUserId', 'productId', 'companyId', 'venueId', 'storeId', 'tokenRevision'] as const)(
    'rejects foreign %s without consuming a nonce', async field => {
      const { consumeNonce } = fresh()
      await expect(verify(sign(claim()), consumeNonce, { ...scope, [field]: 'foreign-2' }))
        .rejects.toMatchObject(invalid)
      expect(consumeNonce).not.toHaveBeenCalled()
    },
  )
  it('rejects a signature from another key and any payload tampering', async () => {
    const { consumeNonce } = fresh()
    await expect(verify(sign(claim(), Buffer.alloc(32, 33)), consumeNonce)).rejects.toMatchObject(invalid)
    const signed = sign(claim())
    const [encoded, mac] = signed.split('.')
    await expect(verify(encoded!.slice(0, -1) + 'A.' + mac, consumeNonce)).rejects.toMatchObject(invalid)
    expect(consumeNonce).not.toHaveBeenCalled()
  })
  it.each([
    { issuedAt: now + 1 }, { expiresAt: now }, { expiresAt: now + 300_001 },
    { expiresAt: now - 1 }, { issuedAt: now + 60_000, expiresAt: now + 120_000 },
  ])('rejects expired/future/overlong claim %j', async override => {
    const { consumeNonce } = fresh()
    await expect(verify(sign(claim(override)), consumeNonce)).rejects.toMatchObject(invalid)
    expect(consumeNonce).not.toHaveBeenCalled()
  })
  it.each([
    { purpose: 'wrong' }, { nonce: 'short' }, { nonce: 1 },
    { tokenRevision: '01' }, { tokenRevision: '9223372036854775808' },
    { extra: 'unrecognized' }, { storeId: '' }, { sessionId: null },
  ])('rejects malformed signed claim %j', async override => {
    const { consumeNonce } = fresh()
    await expect(verify(sign(claim(override)), consumeNonce)).rejects.toMatchObject(invalid)
    expect(consumeNonce).not.toHaveBeenCalled()
  })
  it('rejects missing proof, malformed base64url, and invalid key', async () => {
    const { consumeNonce } = fresh()
    for (const proof of ['', 'bad', sign(claim()).replace('.', '..'), sign(claim()) + '=']) {
      await expect(verify(proof, consumeNonce)).rejects.toMatchObject(invalid)
    }
    await expect(verify(sign(claim()), consumeNonce, scope, now, Buffer.alloc(16))).rejects.toMatchObject(invalid)
    expect(consumeNonce).not.toHaveBeenCalled()
  })
  it('rejects a failing nonce store, including DB exceptions', async () => {
    await expect(verify(sign(claim()), async () => false)).rejects.toMatchObject(invalid)
    await expect(verify(sign(claim()), async () => { throw Error('db secret') })).rejects.toMatchObject(invalid)
  })
  it('rejects stale expected revision and out-of-range revision', async () => {
    const { consumeNonce } = fresh()
    await expect(verify(sign(claim()), consumeNonce, { ...scope, tokenRevision: '1' })).rejects.toMatchObject(invalid)
    await expect(verify(sign(claim()), consumeNonce, { ...scope, tokenRevision: '9223372036854775808' }))
      .rejects.toMatchObject(invalid)
    expect(consumeNonce).not.toHaveBeenCalled()
  })
})
