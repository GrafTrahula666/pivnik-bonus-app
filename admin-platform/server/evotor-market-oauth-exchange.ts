/**
 * P0.2 prerequisite (UNMOUNTED): exchange a server-obtained Evotor OAuth
 * authorization code. This returns a scoped access token, NOT an identity,
 * company grant, owner proof, tenant binding or license.
 *
 * Official authorization_code contract:
 * https://developer.evotor.ru/docs/rest_oauth20_authorization_guide.html
 * The caller must first verify a session-bound, single-use OAuth state in a
 * durable store, then independently verify store ownership with the token.
 * Never accept client credentials or redirect URI from a browser request.
 */
const endpoint = 'https://oauth.evotor.ru/oauth/token'
const deadlineMs = 10_000
const maxBodyBytes = 16_384

export class EvotorOAuthExchangeError extends Error {
  readonly code = 'EVOTOR_OAUTH_EXCHANGE_UNAVAILABLE'
  readonly statusCode = 503
  constructor() { super('Не удалось подтвердить авторизацию Эвотора.') }
}
const unavailable = () => new EvotorOAuthExchangeError()
const printable = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max
  && /^[\x21-\x7e]+$/.test(value)

export async function exchangeEvotorAuthorizationCode({
  code, clientId, clientSecret, redirectUri, fetchImpl = fetch,
}: {
  code: string
  clientId: string
  clientSecret: string
  redirectUri: string
  fetchImpl?: typeof fetch
}): Promise<Readonly<{ accessToken: string; expiresInSeconds: number; scope: readonly string[] }>> {
  // All four values must originate from trusted server configuration/state.
  // No redirects or arbitrary callback destinations.
  let redirect: URL
  try { redirect = new URL(redirectUri) } catch { throw unavailable() }
  if (!printable(code, 2_048) || !printable(clientId, 256)
    || !printable(clientSecret, 2_048)
    || redirect.protocol !== 'https:' || !redirect.hostname || redirect.username
    || redirect.password || redirect.hash || redirect.href !== redirectUri
    || typeof fetchImpl !== 'function') throw unavailable()

  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(unavailable()) }, deadlineMs)
  })
  async function request() {
    const body = new URLSearchParams({
      code, grant_type: 'authorization_code', redirect_uri: redirectUri,
    })
    const authorization = Buffer.from(clientId + ':' + clientSecret).toString('base64')
    let response: Response
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST', redirect: 'error', cache: 'no-store',
        signal: controller.signal, headers: {
          Authorization: 'Basic ' + authorization,
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        }, body,
      })
    } catch { throw unavailable() }
    try {
      if (controller.signal.aborted || response.status !== 200
        || response.redirected || (response.url && response.url !== endpoint)
        || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || ''))
        throw unavailable()
      const length = response.headers.get('content-length')
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBodyBytes))
        throw unavailable()
      if (!response.body) throw unavailable()
      reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let total = 0
      try {
        for (;;) {
          if (controller.signal.aborted) throw unavailable()
          const part = await reader.read()
          if (controller.signal.aborted) throw unavailable()
          if (part.done) break
          total += part.value.byteLength
          if (total > maxBodyBytes) throw unavailable()
          chunks.push(part.value)
        }
      } finally {
        void reader.cancel().catch(() => undefined)
        reader.releaseLock(); reader = undefined
      }
      if (length !== null && total !== Number(length)) throw unavailable()
      let data: unknown
      try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) }
      catch { throw unavailable() }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw unavailable()
      const result = data as Record<string, unknown>
      if (!printable(result.access_token, 4_096)
        || typeof result.token_type !== 'string' || result.token_type.toLowerCase() !== 'bearer'
        || !Number.isSafeInteger(result.expires_in) || (result.expires_in as number) <= 0
        || (result.expires_in as number) > 2_592_000
        || typeof result.scope !== 'string') throw unavailable()
      const scope = result.scope.split(' ').filter(Boolean)
      // A scoped store read is the minimum proof prerequisite.
      if (!scope.includes('store:read') || new Set(scope).size !== scope.length) throw unavailable()
      return Object.freeze({
        accessToken: result.access_token,
        expiresInSeconds: result.expires_in as number,
        scope: Object.freeze(scope),
      })
    } finally { void response.body?.cancel().catch(() => undefined) }
  }
  try { return await Promise.race([request(), deadline]) }
  catch { throw unavailable() }
  finally {
    if (timer !== undefined) clearTimeout(timer)
    controller.abort()
    if (reader) void reader.cancel().catch(() => undefined)
  }
}
