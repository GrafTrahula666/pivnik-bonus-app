import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'

const db = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }))
vi.mock('../db.js', () => ({ pool: db }))

import { login } from '../auth.js'
import { __resetRateLimitBucketsForTests, hashPassword } from '../security.js'

const password = 'Correct Horse Battery 2026!'
const passwordHash = hashPassword(password)
const request = (ip: string) => ({ headers: {}, socket: { remoteAddress: ip } }) as IncomingMessage
const response = () => ({ setHeader: vi.fn() }) as unknown as ServerResponse
const attempt = (email: string, ip = '192.0.2.1', suppliedPassword = 'wrong') =>
  login(request(ip), response(), email, suppliedPassword)

describe('Admin login aggregate rate limits', () => {
  beforeEach(() => {
    __resetRateLimitBucketsForTests()
    vi.clearAllMocks()
    db.query.mockResolvedValue({ rows: [] })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    __resetRateLimitBucketsForTests()
  })

  it('retains the six-attempt IP/account pair cap before querying credentials', async () => {
    for (let i = 0; i < 6; i++) {
      await expect(attempt('owner@example.com')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    }
    await expect(attempt(' OWNER@EXAMPLE.COM ')).rejects.toMatchObject({ statusCode: 429, code: 'RATE_LIMITED' })
    expect(db.query).toHaveBeenCalledTimes(6)
    expect(db.connect).not.toHaveBeenCalled()
  })

  it('caps attempts from one IP even when every email is different', async () => {
    for (let i = 0; i < 30; i++) {
      await expect(attempt(`owner${i}@example.com`)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    }
    await expect(attempt('another@example.com')).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    expect(db.query).toHaveBeenCalledTimes(30)
    await expect(attempt('another@example.com', '192.0.2.2')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  })

  it('caps a normalized account across changing IPs and email casing', async () => {
    for (let i = 0; i < 15; i++) {
      const email = i % 2 ? ' OWNER@EXAMPLE.COM ' : 'owner@example.com'
      await expect(attempt(email, `192.0.2.${i + 1}`)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    }
    await expect(attempt('Owner@Example.Com', '192.0.2.99')).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    expect(db.query).toHaveBeenCalledTimes(15)
    expect(db.query.mock.calls.every((call) => call[1][0] === 'owner@example.com')).toBe(true)
    await expect(attempt('other@example.com', '192.0.2.99')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  })

  it.each(['pair', 'account', 'ip'] as const)('expires the %s limit after fifteen minutes', async (bucket) => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const count = bucket === 'pair' ? 6 : bucket === 'account' ? 15 : 30
    for (let i = 0; i < count; i++) {
      const email = bucket === 'ip' ? `owner${i}@example.com` : 'owner0@example.com'
      const ip = bucket === 'account' ? `192.0.2.${i + 1}` : '192.0.2.1'
      await expect(attempt(email, ip)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    }
    await expect(attempt('owner0@example.com')).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    clock.mockReturnValue(1_000_000 + 15 * 60 * 1000)
    await expect(attempt('owner0@example.com')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  })

  it('allows five real accounts to establish sessions from the same IP', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
    db.connect.mockResolvedValue(client)
    db.query.mockImplementation(async (_sql: string, values: string[]) => ({ rows: [{
      id: values[0], email: values[0], display_name: 'Owner', role: 'VENUE_ADMIN',
      password_hash: passwordHash, active: true,
    }] }))
    for (let i = 0; i < 5; i++) {
      const res = response()
      const email = `owner${i}@example.com`
      await expect(login(request('192.0.2.1'), res, email, password)).resolves.toMatchObject({ admin: { email } })
      expect(res.setHeader).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('HttpOnly'))
    }
    expect(db.connect).toHaveBeenCalledTimes(5)
    expect(client.release).toHaveBeenCalledTimes(5)
  })
})
