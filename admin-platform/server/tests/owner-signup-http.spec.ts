// @vitest-environment node
import http from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../config.js'
import { __resetRateLimitBucketsForTests } from '../security.js'

const state = vi.hoisted(() => ({ queries: 0 }))
vi.mock('../db.js', () => {
  const fail = async () => {
    state.queries += 1
    throw new Error('Signup must not access a database before verification is available')
  }
  const adapter = { query: fail, connect: fail }
  return { pool: adapter, readPool: adapter, writePool: null,
    tableExists: async () => false, productionTableExists: async () => false }
})

const body = { email: 'New.Owner@fixture.invalid', displayName: 'New owner', password: 'Secure-Owner-Test-2026!' }
const validOrigin = 'https://owner-signup.fixture.invalid'
const initial = {
  enableWrites: config.enableWrites,
  enableOnboardingDrafts: config.enableOnboardingDrafts,
  enableOwnerSignup: config.enableOwnerSignup,
  publicOrigin: config.publicOrigin,
}

describe('CHAT 04 #492: actual unauthenticated signup HTTP gate', () => {
  let server: http.Server
  let endpoint = ''

  beforeAll(async () => {
    config.publicOrigin = validOrigin
    const { handleApi, sendApiError } = await import('../router.js')
    server = http.createServer((req, res) => {
      void handleApi(req, res, new URL(req.url!, endpoint)).catch(error => sendApiError(res, error, req))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    endpoint = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
  })

  beforeEach(() => {
    config.enableWrites = false
    config.enableOnboardingDrafts = false
    config.enableOwnerSignup = false
    config.publicOrigin = validOrigin
    state.queries = 0
    __resetRateLimitBucketsForTests()
  })

  afterAll(async () => {
    Object.assign(config, initial)
    if (server) await new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve()))
  })

  async function signup(value: unknown = body, origin = validOrigin) {
    return fetch(endpoint + '/api/admin/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify(value),
    })
  }

  async function confirm(value: unknown = { token: 'A'.repeat(43) }, origin = validOrigin) {
    return fetch(endpoint + '/api/admin/auth/signup/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify(value),
    })
  }

  it('rejects unauthenticated signup by default and touches no admin DB tables', async () => {
    const response = await signup()
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'OWNER_SIGNUP_DISABLED' })
    expect(state.queries).toBe(0)
  })

  it('refuses even fully enabled signup without email verification; never returns a password', async () => {
    config.enableWrites = config.enableOnboardingDrafts = config.enableOwnerSignup = true
    const response = await signup()
    expect(response.status).toBe(503)
    const payload = await response.json()
    expect(payload).toMatchObject({ code: 'OWNER_SIGNUP_VERIFICATION_UNAVAILABLE' })
    expect(JSON.stringify(payload)).not.toContain(body.password)
    expect(state.queries).toBe(0)
  })

  it('keeps HTTP confirmation closed while the signup gates are disabled', async () => {
    const response = await confirm()
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'OWNER_SIGNUP_DISABLED' })
    expect(state.queries).toBe(0)
  })

  it('rejects confirmation from an untrusted Origin before any database access', async () => {
    config.enableWrites = config.enableOnboardingDrafts = config.enableOwnerSignup = true
    const response = await confirm({ token: 'A'.repeat(43) }, 'https://outside.fixture.invalid')
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'ORIGIN_REJECTED' })
    expect(state.queries).toBe(0)
  })

  it('rejects forged owner roles and company scope before any database access', async () => {
    config.enableWrites = config.enableOnboardingDrafts = config.enableOwnerSignup = true
    for (const extra of [{ role: 'SUPER_ADMIN' }, { companyId: '1' }, { verified: true }]) {
      const response = await signup({ ...body, ...extra })
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ code: 'OWNER_SIGNUP_INVALID' })
    }
    expect(state.queries).toBe(0)
  })

  it('enforces origin before registration even when rollout flags are enabled', async () => {
    config.enableWrites = config.enableOnboardingDrafts = config.enableOwnerSignup = true
    const response = await signup(body, 'https://outside.fixture.invalid')
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'ORIGIN_REJECTED' })
    expect(state.queries).toBe(0)
  })

  it('rejects oversized JSON bodies and never attempts persistence', async () => {
    config.enableWrites = config.enableOnboardingDrafts = config.enableOwnerSignup = true
    const response = await signup({ ...body, displayName: 'A'.repeat(3000) })
    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({ code: 'BODY_TOO_LARGE' })
    expect(state.queries).toBe(0)
  })
})
