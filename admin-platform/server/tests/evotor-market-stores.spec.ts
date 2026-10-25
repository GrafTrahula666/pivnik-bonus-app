// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyEvotorMarketStores } from '../evotor-market-stores.js'

const token = 'synthetic-cloud-token-not-a-real-credential', expectedUserId = '01-000000000000001'
const store = (id = '20170228-F4F1-401B-80FA-9ECCA8451FFB', user_id = expectedUserId) => ({ id, user_id })
const json = (items: unknown[], paging: unknown = {}) => new Response(JSON.stringify({ items, paging }), {
  headers: { 'content-type': 'application/vnd.evotor.v2+json; charset=UTF-8' },
})
const run = (fetchImpl: typeof fetch) => verifyEvotorMarketStores({ token, expectedUserId, fetchImpl })
const rejects = async (fetchImpl: typeof fetch, code = 'INVALID_RESPONSE') => {
  await expect(run(fetchImpl)).rejects.toMatchObject({ statusCode: 503, code: `EVOTOR_MARKET_STORES_${code}` })
}
afterEach(() => vi.useRealTimers())

describe('Evotor Market complete store ownership read', () => {
  it('returns immutable records only after the final page; encodes opaque cursors on the fixed origin', async () => {
    const cursor = 'https://attacker.invalid/path?secret=1&other=2+/='
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(json([store()], { next_cursor: cursor }))
      .mockResolvedValueOnce(json([store('second-store')]))
    const result = await run(transport)
    expect(result).toEqual([{ storeId: store().id, userId: expectedUserId }, { storeId: 'second-store', userId: expectedUserId }])
    expect(Object.isFrozen(result)).toBe(true)
    expect(result.every(Object.isFrozen)).toBe(true)
    expect(transport).toHaveBeenCalledTimes(2)
    const [first, options] = transport.mock.calls[0]!, [second] = transport.mock.calls[1]!
    expect(String(first)).toBe('https://api.evotor.ru/stores')
    const next = new URL(String(second))
    expect(next.origin).toBe('https://api.evotor.ru'); expect(next.pathname).toBe('/stores')
    expect([...next.searchParams.keys()]).toEqual(['cursor']); expect(next.searchParams.get('cursor')).toBe(cursor)
    expect(options).toMatchObject({ method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.evotor.v2+json', 'Content-Type': 'application/vnd.evotor.v2+json' } })
  })
  it('accepts an explicitly complete empty collection', async () => {
    expect(await run(vi.fn<typeof fetch>().mockResolvedValue(json([])))).toEqual([])
  })
  it('rejects a foreign owner on a later page without returning earlier stores', async () => {
    await rejects(vi.fn<typeof fetch>().mockResolvedValueOnce(json([store()], { next_cursor: 'next' }))
      .mockResolvedValueOnce(json([store('foreign-store', 'other-owner')])), 'OWNERSHIP_MISMATCH')
  })
  it.each([
    { items: [] }, { items: [], paging: {}, next_cursor: 'outside-paging' }, { items: [], paging: null }, { items: [], paging: [] }, { items: {}, paging: {} },
    { items: [], paging: { next_cursor: null } }, { items: [], paging: { next_cursor: '' } },
    { items: [], paging: { next_cursor: 'bad\nvalue' } }, { items: [], paging: { next_cursor: 1 } },
    { items: [], paging: { next_cursor: 'x'.repeat(4097) } }, { items: [], paging: { url: 'https://attacker.invalid' } },
    { items: [null], paging: {} }, { items: [{ id: 'a' }], paging: {} },
    { items: [{ id: '../a', user_id: expectedUserId }], paging: {} }, { items: [{ id: 'a', user_id: '' }], paging: {} },
    { items: Array.from({ length: 1001 }, () => store()), paging: {} },
  ])('rejects malformed/incomplete response %#', async raw => {
    await rejects(vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(raw), { headers: { 'content-type': 'application/json' } })))
  })
  it('rejects repeated cursors even across empty pages', async () => {
    await rejects(vi.fn<typeof fetch>().mockResolvedValue(json([], { next_cursor: 'same' })))
  })
  it('bounds a non-repeating page chain without claiming completeness', async () => {
    let page = 0
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => json([], { next_cursor: String(++page) }))
    await rejects(transport, 'INCOMPLETE'); expect(transport).toHaveBeenCalledTimes(50)
  })
  it('caps the total store collection', async () => {
    let page = 0
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => {
      page++; return json(Array.from({ length: 1000 }, (_, i) => store(`store-${page}-${i}`)), { next_cursor: String(page) })
    })
    await rejects(transport, 'INCOMPLETE'); expect(transport).toHaveBeenCalledTimes(6)
  })
  it('rejects duplicate IDs across pages including case variants', async () => {
    await rejects(vi.fn<typeof fetch>().mockResolvedValueOnce(json([store('STORE')], { next_cursor: 'next' })).mockResolvedValueOnce(json([store('store')])))
  })
  it.each([[206, 'UNAVAILABLE'], [401, 'AUTH_REJECTED'], [403, 'FORBIDDEN'], [429, 'RATE_LIMITED'], [500, 'UNAVAILABLE']])('fails closed for HTTP %s', async (status, code) => {
    await rejects(vi.fn<typeof fetch>().mockResolvedValue(new Response(token, { status: Number(status) })), String(code))
  })
  it('does not preserve provider exception text or credentials in errors', async () => {
    const error = await run(vi.fn<typeof fetch>().mockRejectedValue(new Error(`request ${token} failed`))).catch(value => value)
    expect(String(error)).not.toContain(token); expect(error).not.toHaveProperty('cause')
    expect(error).toMatchObject({ code: 'EVOTOR_MARKET_STORES_UNAVAILABLE' })
  })
  it.each(['<html>Login</html>', '{', '\u0000'])('rejects invalid JSON', async raw => {
    await rejects(vi.fn<typeof fetch>().mockResolvedValue(new Response(raw, { headers: { 'content-type': 'application/json' } })))
  })
  it('rejects HTML and redirected/mismatched responses', async () => {
    await rejects(vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { headers: { 'content-type': 'text/html' } })))
    const response = json([]); Object.defineProperty(response, 'url', { value: 'https://attacker.invalid/stores' })
    await rejects(vi.fn<typeof fetch>().mockResolvedValue(response))
    const redirected = json([]); Object.defineProperty(redirected, 'redirected', { value: true })
    await rejects(vi.fn<typeof fetch>().mockResolvedValue(redirected))
  })
  it('caps streamed bytes without Content-Length', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(1_048_577)) }, cancel() { cancelled = true } })
    await rejects(vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { headers: { 'content-type': 'application/json' } })))
    expect(cancelled).toBe(true)
  })
  it('bounds aggregate bytes across individually valid-sized pages', async () => {
    let page = 0
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => {
      const text = JSON.stringify({ items: [], paging: { next_cursor: String(++page) } }) + ' '.repeat(900_000)
      return new Response(text, { headers: { 'content-type': 'application/json' } })
    })
    await rejects(transport); expect(transport).toHaveBeenCalledTimes(6)
  })
  it('cancels rejected HTTP bodies without reading provider prose', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true } })
    await rejects(vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 403 })), 'FORBIDDEN')
    expect(cancelled).toBe(true)
  })
  it('requires the complete declared Content-Length before accepting store evidence', async () => {
    const body = JSON.stringify({ items: [store()], paging: {} })
    const bytes = Buffer.byteLength(body)
    const response = (length: number) => new Response(body, {
      headers: { 'content-type': 'application/json', 'content-length': String(length) },
    })
    expect(await run(vi.fn<typeof fetch>().mockResolvedValue(response(bytes)))).toEqual([
      { storeId: store().id, userId: expectedUserId },
    ])
    // Both a truncated body and surplus bytes make completeness unprovable,
    // even if the received bytes happen to form syntactically valid JSON.
    await rejects(vi.fn<typeof fetch>().mockResolvedValue(response(bytes + 1)))
    await rejects(vi.fn<typeof fetch>().mockResolvedValue(response(bytes - 1)))
  })
  it('rejects oversized Content-Length and invalid UTF-8', async () => {
    await rejects(vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '1048577' } })))
    await rejects(vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } })))
  })
  it('bounds stalled body reading and cancels without returning partial records', async () => {
    vi.useFakeTimers()
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({ start() {}, cancel() { cancelled = true } })
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { headers: { 'content-type': 'application/json' } }))
    const assertion = rejects(transport, 'UNAVAILABLE'); await vi.advanceTimersByTimeAsync(15_000); await assertion
    expect(cancelled).toBe(true); expect((transport.mock.calls[0]![1]!.signal as AbortSignal).aborted).toBe(true)
  })
  it('shares the same deadline across headers, all pages and bodies', async () => {
    vi.useFakeTimers()
    const transport = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise(resolve => {
      setTimeout(() => resolve(json([store()], { next_cursor: 'next' })), 14_000)
    })).mockImplementationOnce(() => new Promise(() => undefined))
    const assertion = rejects(transport, 'UNAVAILABLE')
    await vi.advanceTimersByTimeAsync(15_000); await assertion
    expect(transport).toHaveBeenCalledTimes(2)
  })
  it('cancels a response arriving after the caller has timed out', async () => {
    vi.useFakeTimers()
    let cancelled = false, deliver: ((response: Response) => void) | undefined
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true } })
    const transport = vi.fn<typeof fetch>().mockImplementation(() => new Promise(resolve => { deliver = resolve }))
    const assertion = rejects(transport, 'UNAVAILABLE')
    await vi.advanceTimersByTimeAsync(15_000); await assertion
    deliver!(new Response(body, { headers: { 'content-type': 'application/json' } }))
    await vi.advanceTimersByTimeAsync(0)
    expect(cancelled).toBe(true)
  })
  it('bounds transports ignoring abort during headers', async () => {
    vi.useFakeTimers()
    const transport = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => undefined))
    const assertion = rejects(transport, 'UNAVAILABLE'); await vi.advanceTimersByTimeAsync(15_000); await assertion
    expect((transport.mock.calls[0]![1]!.signal as AbortSignal).aborted).toBe(true)
  })
  it.each([{ token: 'bad\r\nHeader', expectedUserId }, { token, expectedUserId: '' }, { token, expectedUserId: 'a b' }])('rejects invalid config before network', async input => {
    const transport = vi.fn<typeof fetch>()
    await expect(verifyEvotorMarketStores({ ...input, fetchImpl: transport })).rejects.toMatchObject({ code: 'EVOTOR_MARKET_STORES_INVALID_CONFIGURATION' })
    expect(transport).not.toHaveBeenCalled()
  })
})
