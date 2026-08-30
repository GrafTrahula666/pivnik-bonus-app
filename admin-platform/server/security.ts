import crypto from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { config, isProduction } from './config.js'
import { HttpError } from './types.js'

const N=1<<15, R=8, P=1, KEYLEN=64, MAXMEM=64*1024*1024
export const normalizeEmail=(v:unknown)=>String(v??'').trim().toLowerCase()
export function validatePasswordPolicy(password:string) {
  if (password.length<12) throw new HttpError(400,'WEAK_PASSWORD','Пароль должен содержать минимум 12 символов.')
  if (password.length>256) throw new HttpError(400,'PASSWORD_TOO_LONG','Пароль слишком длинный.')
}
export function hashPassword(password:string):string {
  validatePasswordPolicy(password)
  const salt=crypto.randomBytes(16)
  const hash=crypto.scryptSync(password,salt,KEYLEN,{N,r:R,p:P,maxmem:MAXMEM})
  return ['scrypt',N,R,P,salt.toString('base64url'),hash.toString('base64url')].join('$')
}
export function verifyPassword(password:string, encoded:string):boolean {
  try {
    const [alg,n,r,p,saltText,hashText]=encoded.split('$')
    if (alg!=='scrypt'||!saltText||!hashText) return false
    const expected=Buffer.from(hashText,'base64url')
    const actual=crypto.scryptSync(password,Buffer.from(saltText,'base64url'),expected.length,{N:Number(n),r:Number(r),p:Number(p),maxmem:MAXMEM})
    return expected.length===actual.length && crypto.timingSafeEqual(expected,actual)
  } catch { return false }
}
export const randomToken=(bytes=32)=>crypto.randomBytes(bytes).toString('base64url')
export const sha256=(v:string)=>crypto.createHash('sha256').update(v).digest('hex')
export const safeEqual=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y)}
export function csrfTokenFor(sessionToken:string):string {
  const secret=config.csrfSecret || (isProduction ? '' : 'development-csrf-secret-only-not-production-123456')
  return crypto.createHmac('sha256',secret).update(sessionToken).digest('base64url')
}
export function parseCookies(header:string|undefined):Record<string,string> {
  const out:Record<string,string>={}
  for (const part of String(header||'').split(';')) { const i=part.indexOf('='); if(i>0) out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim()) }
  return out
}
export function setSessionCookie(res:ServerResponse, token:string) {
  const f=[`${config.sessionCookie}=${encodeURIComponent(token)}`,'Path=/','HttpOnly','SameSite=Strict',`Max-Age=${Math.floor(config.sessionTtlMs/1000)}`]
  if(config.secureCookies) f.push('Secure')
  res.setHeader('Set-Cookie',f.join('; '))
}
export function clearSessionCookie(res:ServerResponse) {
  const f=[`${config.sessionCookie}=`,'Path=/','HttpOnly','SameSite=Strict','Max-Age=0']; if(config.secureCookies)f.push('Secure');res.setHeader('Set-Cookie',f.join('; '))
}
export function requestIp(req:IncomingMessage):string {
  if(config.trustProxy){const v=String(req.headers['x-forwarded-for']||'').split(',')[0]?.trim();if(v)return v}
  return String(req.socket.remoteAddress||'unknown')
}
export const hashIp=(req:IncomingMessage)=>sha256(requestIp(req)).slice(0,24)
export function enforceOrigin(req:IncomingMessage) {
  const method=String(req.method||'GET').toUpperCase()
  if(!['POST','PUT','PATCH','DELETE'].includes(method))return
  const origin=String(req.headers.origin||'')
  if(config.publicOrigin && origin!==config.publicOrigin) throw new HttpError(403,'ORIGIN_REJECTED','Недопустимый Origin.')
  if(isProduction&&!config.publicOrigin) throw new HttpError(500,'ORIGIN_NOT_CONFIGURED','Origin policy is not configured.')
}
export async function readJsonBody<T=Record<string,unknown>>(req:IncomingMessage,maxBytes=64*1024):Promise<T>{
  let size=0;const chunks:Buffer[]=[]
  for await(const chunk of req){const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=b.length;if(size>maxBytes)throw new HttpError(413,'BODY_TOO_LARGE','Слишком большой запрос.');chunks.push(b)}
  const raw=Buffer.concat(chunks).toString('utf8');if(!raw)return {} as T
  try{return JSON.parse(raw) as T}catch{throw new HttpError(400,'INVALID_JSON','Некорректный JSON.')}
}
const buckets=new Map<string,number[]>()
export function enforceRateLimit(key:string,limit:number,windowMs:number) {
  const now=Date.now(), current=(buckets.get(key)||[]).filter(t=>now-t<windowMs)
  if(current.length>=limit)throw new HttpError(429,'RATE_LIMITED','Слишком много попыток. Повторите позже.')
  current.push(now);buckets.set(key,current)
}
export function securityHeaders(res:ServerResponse){
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer')
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');res.setHeader('Cache-Control','no-store')
  res.setHeader('Content-Security-Policy',["default-src 'self'","script-src 'self'","style-src 'self' 'unsafe-inline' https://fonts.googleapis.com","font-src 'self' https://fonts.gstatic.com","img-src 'self' data: https:","connect-src 'self'","object-src 'none'","base-uri 'self'","frame-ancestors 'none'","form-action 'self'"].join('; '))
}
