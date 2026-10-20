import crypto from 'node:crypto'
import { HttpError } from './types.js'

const KEY_ID_PATTERN=/^[a-z0-9][a-z0-9._-]{0,63}$/
const MAX_KEYRING_BYTES=20_000
const MAX_KEYS=5

export interface OnboardingSecretEnvelope {
  keyId:string
  nonce:Buffer|Uint8Array
  ciphertext:Buffer|Uint8Array
  authTag:Buffer|Uint8Array
}

const unavailable=()=>new HttpError(503,'ONBOARDING_SECRET_KEY_UNAVAILABLE','Защищённое хранилище ключей мастера не настроено или недоступно.')

function keyBytes(raw:unknown):Buffer {
  if(typeof raw!=='string'||raw.length>128)throw unavailable()
  const decoded=Buffer.from(raw,'base64')
  if(decoded.length!==32||decoded.toString('base64')!==raw)throw unavailable()
  return decoded
}

function parseKeyring(env:NodeJS.ProcessEnv) {
  const activeKeyId=String(env.ADMIN_ONBOARDING_SECRET_ACTIVE_KEY_ID||'').trim()
  const source=String(env.ADMIN_ONBOARDING_SECRET_KEYRING||'')
  if(!KEY_ID_PATTERN.test(activeKeyId)||!source||Buffer.byteLength(source)>MAX_KEYRING_BYTES)throw unavailable()
  let parsed:unknown
  try {parsed=JSON.parse(source)} catch {throw unavailable()}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw unavailable()
  const entries=Object.entries(parsed as Record<string,unknown>)
  if(!entries.length||entries.length>MAX_KEYS)throw unavailable()
  const keys=new Map<string,Buffer>()
  for(const [keyId,value] of entries) {
    if(!KEY_ID_PATTERN.test(keyId)||keys.has(keyId))throw unavailable()
    keys.set(keyId,keyBytes(value))
  }
  if(!keys.has(activeKeyId))throw unavailable()
  return {activeKeyId,keys}
}

function aadBytes(aad:string):Buffer {
  const value=Buffer.from(aad,'utf8')
  if(!value.length||value.length>1024)throw unavailable()
  return value
}

function envelopeBytes(value:Buffer|Uint8Array,expected?:number):Buffer {
  const bytes=Buffer.from(value)
  if((expected!==undefined&&bytes.length!==expected)||(!expected&&(bytes.length<1||bytes.length>8192)))throw unavailable()
  return bytes
}

export function onboardingSecretBox(env:NodeJS.ProcessEnv=process.env) {
  const {activeKeyId,keys}=parseKeyring(env)
  const key=(keyId:string)=>{
    const value=keys.get(keyId)
    if(!value)throw unavailable()
    return value
  }
  return {
    activeKeyId,
    encrypt(plaintext:string,aad:string):OnboardingSecretEnvelope {
      const clear=Buffer.from(plaintext,'utf8')
      if(!clear.length||clear.length>4096)throw unavailable()
      const nonce=crypto.randomBytes(12)
      const cipher=crypto.createCipheriv('aes-256-gcm',key(activeKeyId),nonce)
      cipher.setAAD(aadBytes(aad),{plaintextLength:clear.length})
      const ciphertext=Buffer.concat([cipher.update(clear),cipher.final()])
      return {keyId:activeKeyId,nonce,ciphertext,authTag:cipher.getAuthTag()}
    },
    decrypt(envelope:OnboardingSecretEnvelope,aad:string):string {
      try {
        const nonce=envelopeBytes(envelope.nonce,12),authTag=envelopeBytes(envelope.authTag,16)
        const ciphertext=envelopeBytes(envelope.ciphertext)
        const decipher=crypto.createDecipheriv('aes-256-gcm',key(envelope.keyId),nonce)
        decipher.setAAD(aadBytes(aad),{plaintextLength:ciphertext.length})
        decipher.setAuthTag(authTag)
        return Buffer.concat([decipher.update(ciphertext),decipher.final()]).toString('utf8')
      } catch(error) {
        if(error instanceof HttpError)throw error
        throw unavailable()
      }
    },
    fingerprint(keyId:string,canonicalCommand:string):string {
      return crypto.createHmac('sha256',key(keyId)).update('spaceverse-onboarding-command-v1\0').update(canonicalCommand).digest('hex')
    },
    matchesFingerprint(left:string,right:string):boolean {
      if(!/^[0-9a-f]{64}$/.test(left)||!/^[0-9a-f]{64}$/.test(right))return false
      return crypto.timingSafeEqual(Buffer.from(left,'hex'),Buffer.from(right,'hex'))
    },
  }
}
