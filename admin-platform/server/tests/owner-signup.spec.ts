// @vitest-environment node
import type { IncomingMessage } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { config } from '../config.js'
import { parseOwnerSignupInput, requestOwnerSignup } from '../owner-signup.js'
import { __resetRateLimitBucketsForTests } from '../security.js'

const original = {
  enableWrites: config.enableWrites,
  enableOnboardingDrafts: config.enableOnboardingDrafts,
  enableOwnerSignup: config.enableOwnerSignup,
}
const valid = { email: '  New.Owner@Example.com ', displayName: '  Владелец  ', password: 'Long-Safe-Password-2026' }
const req = { headers: {}, socket: { remoteAddress: '127.0.0.1' } } as IncomingMessage

afterEach(() => {
  Object.assign(config, original)
  __resetRateLimitBucketsForTests()
})

describe('CHAT 04 owner self-signup boundary (#492)', () => {
  it('normalizes input without accepting extra scope/role fields', () => {
    expect(parseOwnerSignupInput(valid)).toEqual({
      email: 'new.owner@example.com', displayName: 'Владелец', password: valid.password,
    })
    for (const extra of [
      { role: 'SUPER_ADMIN' }, { companyId: '1' }, { venueId: '1' },
      { verified: true }, { adminId: '1' }, { tenant: 'pivnik' },
    ]) {
      expect(() => parseOwnerSignupInput({ ...valid, ...extra })).toThrow()
    }
  })

  it('rejects non-string credentials, empty names, controls and weak passwords', () => {
    const invalid = [
      null, [], {}, { ...valid, email: 123 }, { ...valid, email: 'bad@' },
      { ...valid, displayName: '   ' }, { ...valid, displayName: 'Bad\nName' },
      { ...valid, displayName: 'A'.repeat(81) }, { ...valid, password: 'short' },
      { ...valid, password: 'x'.repeat(257) },
    ]
    for (const item of invalid) expect(() => parseOwnerSignupInput(item)).toThrow()
  })

  it('is disabled without ALL three independent rollout gates', () => {
    for (const [writes, drafts, signup] of [
      [false, false, false], [true, false, true],
      [false, true, true], [true, true, false],
    ]) {
      config.enableWrites = writes
      config.enableOnboardingDrafts = drafts
      config.enableOwnerSignup = signup
      expect(() => requestOwnerSignup(req, valid)).toThrowError('Самостоятельная регистрация пока недоступна.')
    }
  })

  it('never creates an unverified account even when every flag is enabled', () => {
    config.enableWrites = true
    config.enableOnboardingDrafts = true
    config.enableOwnerSignup = true
    expect(() => requestOwnerSignup(req, valid)).toThrowError('Подтверждение email ещё не настроено. Учётная запись не создана.')
  })

  it('limits repeated requests per normalized email before any delivery attempt', () => {
    config.enableWrites = true
    config.enableOnboardingDrafts = true
    config.enableOwnerSignup = true
    for (let i = 0; i < 4; i++) {
      expect(() => requestOwnerSignup(req, valid)).toThrowError('Подтверждение email ещё не настроено.')
    }
    expect(() => requestOwnerSignup(req, { ...valid, email: 'NEW.OWNER@example.COM' }))
      .toThrowError('Слишком много попыток.')
  })
})
