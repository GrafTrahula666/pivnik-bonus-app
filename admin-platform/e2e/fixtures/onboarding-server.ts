// Loopback-only proof: built real App + real signed-session router + disposable PGlite.
// No connection to Railway, provider, production DB or external recipients.
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Pool } from 'pg'

process.env.NODE_ENV='development'
process.env.ADMIN_DATABASE_URL=''
process.env.ADMIN_READ_DATABASE_URL=''
process.env.ADMIN_PRODUCTION_WRITE_DATABASE_URL=''
process.env.ADMIN_ENABLE_WRITES='true'
process.env.ADMIN_ENABLE_ONBOARDING_DRAFTS='true'
process.env.ADMIN_ENABLE_ONBOARDING_INTEGRATIONS='true'
process.env.ADMIN_ENABLE_ONBOARDING_PROVISIONING='true'
process.env.ADMIN_ONBOARDING_SECRET_ACTIVE_KEY_ID='e2e-v1'
process.env.ADMIN_ONBOARDING_SECRET_KEYRING=JSON.stringify({'e2e-v1':Buffer.alloc(32,9).toString('base64')})
process.env.ADMIN_ENABLE_ONBOARDING_INVITATIONS=process.env.SPACEVERSE_E2E_INVITATIONS==='true'?'true':'false'
process.env.ADMIN_PUBLIC_ORIGIN='http://127.0.0.1:5097'
process.env.ADMIN_CSRF_SECRET='synthetic-loopback-onboarding-csrf-secret-123456'
process.env.ADMIN_SECURE_COOKIES='false'
process.env.PIVNIK_APP_URL=''
process.env.BUSINESS_INTERNAL_TOKEN=''

// Deterministic provider fixture: exercises the real adapter without any live token,
// account, webhook, cash register or network request to Evotor.
const nativeFetch=globalThis.fetch
globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const target=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url)
  if(target.hostname==='api.evotor.ru') {
    return new Response(JSON.stringify({items:[],paging:{}}),{status:200,headers:{'content-type':'application/json'}})
  }
  return nativeFetch(input,init)
}) as typeof fetch

const {onboardingFixture}=await import('../../server/tests/onboarding-fixture.js')
const db=await onboardingFixture()
await db.exec(`CREATE TABLE users(id BIGINT PRIMARY KEY,role TEXT,merged_into_user_id BIGINT,deleted_at TIMESTAMPTZ);
  CREATE TABLE bar_customers(bar_id BIGINT,user_id BIGINT,status TEXT);`)
const query=async(text:string,params?:unknown[])=>{
  const result=await db.query(text,params)
  return {...result,rowCount:result.rows.length||result.affectedRows||0}
}
const {pool,readPool}=await import('../../server/db.js')
pool.query=query as Pool['query'];readPool.query=query as Pool['query']
pool.connect=(async()=>({query,release(){}})) as unknown as Pool['connect']
readPool.connect=pool.connect
const {handleApi,sendApiError}=await import('../../server/router.js')
const root=fileURLToPath(new URL('../../dist/',import.meta.url))
const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'}
const server=http.createServer((req,res)=>{void (async()=>{
  const url=new URL(req.url!,'http://127.0.0.1:5097')
  if(await handleApi(req,res,url)) return
  const relative=url.pathname==='/'?'index.html':url.pathname.slice(1)
  const file=path.resolve(root,relative)
  if(!file.startsWith(root)||url.pathname.startsWith('/api/')) {res.statusCode=404;res.end();return}
  res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream')
  res.end(await fs.readFile(file))
})().catch(error=>sendApiError(res,error,req))})
server.listen(5097,'127.0.0.1')
async function close() {server.close();await db.close();await Promise.all([pool.end(),readPool.end()]);process.exit(0)}
process.on('SIGTERM',()=>void close());process.on('SIGINT',()=>void close())
