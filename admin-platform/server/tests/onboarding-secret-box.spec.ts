// @vitest-environment node
import {describe,expect,it} from 'vitest'
import {onboardingSecretBox} from '../onboarding-secrets.js'

// All material is synthetic and supplied directly to the unit under test.
// These checks never read or modify a Railway/production keyring.
const v1=Buffer.alloc(32,17).toString('base64')
const v2=Buffer.alloc(32,23).toString('base64')
const keyring=(active:string,keys:Record<string,string>):NodeJS.ProcessEnv=>({
  ADMIN_ONBOARDING_SECRET_ACTIVE_KEY_ID:active,
  ADMIN_ONBOARDING_SECRET_KEYRING:JSON.stringify(keys),
})
const scope=(companyId:string,venueId:string,storeId:string,provider:'evotor'|'pos-proxy'='evotor')=>
  JSON.stringify({draftId:'synthetic-draft',companyId,venueId,storeId,provider})
const expectUnavailable=(action:()=>unknown,secret?:string)=>{
  let caught:unknown
  try{action()}catch(error){caught=error}
  expect(caught).toMatchObject({statusCode:503,code:'ONBOARDING_SECRET_KEY_UNAVAILABLE'})
  if(secret)expect(String((caught as Error).message)).not.toContain(secret)
}

describe('shared onboarding secret box: venue isolation and key rotation',()=>{
  it('binds AES-GCM credentials to the exact company, venue, store and provider',()=>{
    const box=onboardingSecretBox(keyring('synthetic-v1',{'synthetic-v1':v1}))
    const secret='synthetic-evotor-credential-do-not-log'
    const aad=scope('10','101','store-a')
    const first=box.encrypt(secret,aad),second=box.encrypt(secret,aad)
    expect(first.keyId).toBe('synthetic-v1')
    expect(box.decrypt(first,aad)).toBe(secret)
    expect(box.decrypt(second,aad)).toBe(secret)
    expect(Buffer.from(first.nonce).equals(Buffer.from(second.nonce))).toBe(false)
    expect(Buffer.from(first.ciphertext).toString('utf8')).not.toContain(secret)
    expect(Buffer.from(first.ciphertext).equals(Buffer.from(second.ciphertext))).toBe(false)
    for(const otherAad of [
      scope('20','101','store-a'),
      scope('10','202','store-a'),
      scope('10','101','store-b'),
      scope('10','101','store-a','pos-proxy'),
    ])expectUnavailable(()=>box.decrypt(first,otherAad),secret)
  })

  it('rejects tampered ciphertext, auth tag and missing AAD without exposing credentials',()=>{
    const box=onboardingSecretBox(keyring('synthetic-v1',{'synthetic-v1':v1}))
    const secret='synthetic-pos-device-key-123456789'
    const aad=scope('10','101','store-a','pos-proxy')
    const saved=box.encrypt(secret,aad)
    const modifiedCiphertext=Buffer.from(saved.ciphertext)
    modifiedCiphertext[0]=modifiedCiphertext[0]!^1
    expectUnavailable(()=>box.decrypt({...saved,ciphertext:modifiedCiphertext},aad),secret)
    const modifiedTag=Buffer.from(saved.authTag)
    modifiedTag[0]=modifiedTag[0]!^1
    expectUnavailable(()=>box.decrypt({...saved,authTag:modifiedTag},aad),secret)
    expectUnavailable(()=>box.encrypt(secret,''),secret)
    expectUnavailable(()=>box.decrypt(saved,''),secret)
  })

  it('reads old envelopes during rotation and requires rewrapping before removing the old key',()=>{
    const aad=scope('10','101','store-a')
    const secret='synthetic-secret-to-rotate'
    const previous=onboardingSecretBox(keyring('synthetic-v1',{'synthetic-v1':v1}))
    const encryptedOld=previous.encrypt(secret,aad)
    const rotating=onboardingSecretBox(keyring('synthetic-v2',{'synthetic-v1':v1,'synthetic-v2':v2}))
    expect(rotating.activeKeyId).toBe('synthetic-v2')
    expect(rotating.decrypt(encryptedOld,aad)).toBe(secret)
    const rewrapped=rotating.encrypt(rotating.decrypt(encryptedOld,aad),aad)
    expect(rewrapped.keyId).toBe('synthetic-v2')
    const retired=onboardingSecretBox(keyring('synthetic-v2',{'synthetic-v2':v2}))
    expect(retired.decrypt(rewrapped,aad)).toBe(secret)
    expectUnavailable(()=>retired.decrypt(encryptedOld,aad),secret)
    expectUnavailable(()=>previous.decrypt(rewrapped,aad),secret)
  })

  it('rejects invalid keyrings, never returning an unencrypted fallback',()=>{
    const invalid=[
      keyring('missing',{'synthetic-v1':v1}),
      keyring('synthetic-v1',{'synthetic-v1':Buffer.alloc(16,1).toString('base64')}),
      keyring('synthetic-v1',{'synthetic-v1':v1+'='}),
      keyring('synthetic-v1',{}),
      keyring('synthetic-v1',Object.fromEntries([
        ['synthetic-v1',v1],...Array.from({length:5},(_,index)=>['key-'+index,v1])])),
    ]
    for(const env of invalid)expectUnavailable(()=>onboardingSecretBox(env))
  })

  it('uses keyed, scope-sensitive fingerprints and constant-time comparison',()=>{
    const box=onboardingSecretBox(keyring('synthetic-v1',{'synthetic-v1':v1}))
    const canonical=JSON.stringify({scope:scope('10','101','store-a'),token:'synthetic-only'})
    const fingerprint=box.fingerprint('synthetic-v1',canonical)
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(box.matchesFingerprint(fingerprint,fingerprint)).toBe(true)
    expect(box.matchesFingerprint(fingerprint,box.fingerprint('synthetic-v1',canonical+'changed'))).toBe(false)
    expect(box.matchesFingerprint(fingerprint,'not-a-fingerprint')).toBe(false)
    expect(box.matchesFingerprint(fingerprint,'0'.repeat(63))).toBe(false)
    expect(fingerprint).not.toContain('synthetic-only')
    expectUnavailable(()=>box.fingerprint('retired-key',canonical))
  })
})
