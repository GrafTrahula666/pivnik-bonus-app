/**
 * Complete read-only provider evidence; not a tenant binding or a license.
 * Official contract: https://developer.evotor.ru/docs/rest_stores.html
 * Call with server-owned credentials and a previously proven provider user.
 * Empty results contain no ownership evidence. This does not prove ownership of a SPACEVERSE company/install/terminal.
 */
import { HttpError } from './types.js'

export interface EvotorMarketStore { readonly storeId: string; readonly userId: string }
const timeoutMs = 15_000
const maxPages = 50, maxStores = 5_000, maxPageBytes = 1_048_576, maxTotalBytes = 5_242_880
const failure = (code: string) => new HttpError(503, `EVOTOR_MARKET_STORES_${code}`, 'Не удалось подтвердить магазины Эвотора.')
const invalid = () => failure('INVALID_RESPONSE')
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  return value as Record<string, unknown>
}
function identity(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    && !/\s/u.test(value) && !Array.from(value).some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)
}

export async function verifyEvotorMarketStores({ token, expectedUserId, fetchImpl = fetch }: {
  token: string; expectedUserId: string; fetchImpl?: typeof fetch
}): Promise<readonly EvotorMarketStore[]> {
  // No caller-supplied origin, path, store owner or pagination URL.
  if (!identity(expectedUserId, 128) || typeof token !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(token)) throw failure('INVALID_CONFIGURATION')
  const controller = new AbortController()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(failure('UNAVAILABLE')) }, timeoutMs)
  })
  const cancelled = () => { if (controller.signal.aborted) throw failure('UNAVAILABLE') }
  async function complete(): Promise<readonly EvotorMarketStore[]> {
    const stores: EvotorMarketStore[] = []
    const storeIds = new Set<string>(), cursors = new Set<string>()
    let cursor: string | undefined, totalBytes = 0
    for (let page = 0; page < maxPages; page++) {
      cancelled()
      const url = new URL('https://api.evotor.ru/stores')
      if (cursor !== undefined) url.searchParams.set('cursor', cursor)
      let response: Response
      try {
        response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: controller.signal,
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.evotor.v2+json', 'Content-Type': 'application/vnd.evotor.v2+json' } })
      } catch { throw failure('UNAVAILABLE') }
      try {
        cancelled()
        if (response.redirected || (response.url && response.url !== url.href)) throw invalid()
      if (response.status !== 200) throw failure(response.status === 401 ? 'AUTH_REJECTED' : response.status === 403 ? 'FORBIDDEN'
          : response.status === 429 ? 'RATE_LIMITED' : 'UNAVAILABLE')
        if (!/^(application\/json|application\/vnd\.evotor\.v2\+json)(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) throw invalid()
        const length = response.headers.get('content-length')
        if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxPageBytes)) throw invalid()
        if (!response.body) throw invalid()
        reader = response.body.getReader()
        const chunks: Uint8Array[] = []
        let bytes = 0
        try {
          for (;;) {
            cancelled()
            const chunk = await reader.read()
            cancelled()
            if (chunk.done) break
            bytes += chunk.value.byteLength; totalBytes += chunk.value.byteLength
            if (bytes > maxPageBytes || totalBytes > maxTotalBytes) throw invalid()
            chunks.push(chunk.value)
          }
        } finally {
          // Cancellation must not extend the deadline for an uncooperative transport.
          void reader.cancel().catch(() => undefined)
          reader.releaseLock(); reader = undefined
        }
        let raw: unknown
        try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) }
        catch { throw invalid() }
        const body = record(raw), paging = record(body.paging)
        if (!Array.isArray(body.items) || body.items.length > 1_000
          || Object.keys(body).some(key => key !== 'items' && key !== 'paging')
          || Object.keys(paging).some(key => key !== 'next_cursor')) throw invalid()
        for (const entry of body.items) {
          const store = record(entry)
          if (typeof store.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(store.id) || !identity(store.user_id, 128)) throw invalid()
          if (store.user_id !== expectedUserId) throw failure('OWNERSHIP_MISMATCH')
          // Duplicate IDs, even equal rows or case variants, mean ambiguous coverage.
          const id = store.id.toLowerCase()
          if (storeIds.has(id)) throw invalid()
          storeIds.add(id)
          if (stores.length >= maxStores) throw failure('INCOMPLETE')
          stores.push(Object.freeze({ storeId: store.id, userId: store.user_id }))
        }
        if (!Object.hasOwn(paging, 'next_cursor')) return Object.freeze(stores)
        const next = paging.next_cursor
        // Opaque data is encoded only as a query value on the fixed host.
        if (!identity(next, 4_096) || cursors.has(next)) throw invalid()
        cursors.add(next); cursor = next
      } finally {
        // Includes rejected status/headers and a response arriving after timeout.
        void response.body?.cancel().catch(() => undefined)
      }
    }
    throw failure('INCOMPLETE')
  }
  try { return await Promise.race([complete(), deadline]) }
  catch (error) {
    // No transport exception text/cause, provider payload or credentials escapes.
    if (error instanceof HttpError && error.code.startsWith('EVOTOR_MARKET_STORES_')) throw failure(error.code.slice('EVOTOR_MARKET_STORES_'.length))
    throw failure('UNAVAILABLE')
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    controller.abort()
    if (reader) void reader.cancel().catch(() => undefined)
  }
}
