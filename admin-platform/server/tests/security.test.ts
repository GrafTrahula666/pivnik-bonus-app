import { describe,expect,it } from 'vitest'
import { csrfTokenFor,hashPassword,normalizeEmail,verifyPassword } from '../security.js'

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
