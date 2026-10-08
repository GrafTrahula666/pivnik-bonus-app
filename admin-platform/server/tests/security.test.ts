import { describe,expect,it } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { csrfTokenFor,enforceRateLimit,hashPassword,normalizeEmail,requestIp,verifyPassword } from '../security.js'

describe('Admin authentication primitives',()=>{
  it('normalizes email',()=>expect(normalizeEmail('  OWNER@Example.COM ')).toBe('owner@example.com'))
  it('hashes passwords with scrypt and never stores plaintext',()=>{
    const password='Correct Horse Battery 2026!'
    const hash=hashPassword(password)
    expect(hash.startsWith('scrypt$')).toBe(true)
    expect(hash).not.toContain(password)
    expect(verifyPassword(password,hash)).toBe(true)
    expect(verifyPassword('Wrong Password 2026!',hash)).toBe(false)
  })
  it('binds CSRF to the opaque session token',()=>{
    expect(csrfTokenFor('a')).toBe(csrfTokenFor('a'))
    expect(csrfTokenFor('a')).not.toBe(csrfTokenFor('b'))
  })
})

describe('Client IP and rate limiting',()=>{
  const req=(xff:string)=>({headers:{'x-forwarded-for':xff},socket:{remoteAddress:'10.0.0.1'}}) as unknown as IncomingMessage
  it('uses the last forwarded hop so a spoofed first hop is ignored',()=>{
    expect(requestIp(req('6.6.6.6, 203.0.113.9'))).toBe('203.0.113.9')
  })
  it('blocks after the limit within the window',()=>{
    const key=`test:${Math.random()}`
    enforceRateLimit(key,2,60_000);enforceRateLimit(key,2,60_000)
    expect(()=>enforceRateLimit(key,2,60_000)).toThrow()
  })
})
