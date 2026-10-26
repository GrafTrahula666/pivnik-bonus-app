// @vitest-environment node
// Synthetic unmounted OAuth transport tests, NOT live Evotor identity proof.
import { describe, expect, it, vi } from 'vitest'
import { exchangeEvotorAuthorizationCode } from '../evotor-market-oauth-exchange.js'

const input = {
  code: 'one-time-code-abc',
  clientId: '11111111-1111-4111-8111-111111111111',
  clientSecret: 'server-only-secret',
  redirectUri: 'https://spaceverse.example/oauth/callback',
}
const response = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(typeof value === 'string' ? value : JSON.stringify(value), {
    status, headers: { 'content-type': 'application/json', ...headers },
  })
const payload = {
  access_token: 'opaque-access-token', token_type: 'bearer',
  expires_in: 3_600, scope: 'profile:read store:read',
  refresh_token: 'must-never-be-returned',
}
const mock = (fn: (...args: Parameters<typeof fetch>) => Promise<Response>) =>
  vi.fn(fn) as unknown as typeof fetch
const call = (fetchImpl: typeof fetch, overrides: Partial<typeof input> = {}) =>
  exchangeEvotorAuthorizationCode({ ...input, ...overrides, fetchImpl })
const denied = { code: 'EVOTOR_OAUTH_EXCHANGE_UNAVAILABLE', statusCode: 503 }

describe('Evotor OAuth authorization_code exchange (unmounted)', () => {
  it('exchanges code using fixed HTTPS endpoint and server credentials, never returns refresh token', async () => {
    const fetchImpl = mock(async () => response(payload))
    const result = await call(fetchImpl)
    expect(result).toEqual({ accessToken: payload.access_token,
      expiresInSeconds: 3_600, scope: ['profile:read', 'store:read'] })
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.scope)).toBe(true)
    expect(JSON.stringify(result)).not.toContain('refresh')
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0]!
    expect(url).toBe('https://oauth.evotor.ru/oauth/token')
    expect(init?.method).toBe('POST')
    expect(init?.redirect).toBe('error')
    expect(init?.cache).toBe('no-store')
    expect(new Headers(init?.headers).get('authorization'))
      .toBe('Basic ' + Buffer.from(input.clientId + ':' + input.clientSecret).toString('base64'))
    const body = init?.body as URLSearchParams
    expect(body.get('code')).toBe(input.code)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('redirect_uri')).toBe(input.redirectUri)
    expect(body.toString()).not.toContain(input.clientSecret)
  })
  it.each([
    { code: '' }, { code: 'invalid code' }, { clientId: '' },
    { clientSecret: '' }, { redirectUri: 'http://spaceverse.example/callback' },
    { redirectUri: 'https://attacker@spaceverse.example/callback' },
    { redirectUri: 'https://spaceverse.example/callback#fragment' },
  ])('rejects invalid server configuration without any request: %j', async override => {
    const fetchImpl = mock(async () => response(payload))
    await expect(call(fetchImpl, override)).rejects.toMatchObject(denied)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it.each([
    [{ ...payload, scope: 'profile:read' }, 200],
    [{ ...payload, token_type: 'Basic' }, 200],
    [{ ...payload, access_token: '' }, 200],
    [{ ...payload, expires_in: 0 }, 200],
    [{ ...payload, expires_in: 2_592_001 }, 200],
    [{ ...payload, scope: 'store:read store:read' }, 200],
    [payload, 401], [payload, 429], [payload, 500],
  ] as const)('fails closed on response status/shape %j %i', async (value, status) => {
    const fetchImpl = mock(async () => response(value, status))
    await expect(call(fetchImpl)).rejects.toMatchObject(denied)
  })
  it('rejects HTML, truncated body, oversized body and malformed JSON', async () => {
    const responses = [
      response(payload, 200, { 'content-type': 'text/html' }),
      response(payload, 200, { 'content-length': '1' }),
      response(payload, 200, { 'content-length': '16385' }),
      response('{invalid json'),
      response('x'.repeat(16_385)),
    ]
    for (const result of responses) {
      await expect(call(mock(async () => result))).rejects.toMatchObject(denied)
    }
  })
  it('does not leak transport/provider errors or secrets', async () => {
    const fetchImpl = mock(async () => { throw Error('private-secret-from-provider') })
    try { await call(fetchImpl); throw Error('expected failure') }
    catch (error) {
      expect(error).toMatchObject(denied)
      expect(String(error)).not.toContain('private-secret-from-provider')
      expect(String(error)).not.toContain(input.clientSecret)
    }
  })
  it('rejects redirects even if a fetch implementation follows them', async () => {
    const fetchImpl = mock(async () => {
      const r = response(payload)
      Object.defineProperty(r, 'redirected', { value: true })
      return r
    })
    await expect(call(fetchImpl)).rejects.toMatchObject(denied)
  })
})
