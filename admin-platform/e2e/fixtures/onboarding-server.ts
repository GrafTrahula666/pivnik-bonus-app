// Loopback-only proof: built real App + real signed-session router + disposable PGlite.
// No connection to Railway, provider, production DB or external recipients.
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import type { Pool } from 'pg'
import {nativePosFixture} from '../../server/tests/native-pos-fixture.mjs'
import {createRuntimeRelease} from '../../../spaceverse-runtime-release.js'
import {syntheticImageId,syntheticImageInspection} from '../../server/tests/runtime-image-fixture.js'

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
process.env.ADMIN_ENABLE_ONBOARDING_WORKFLOW=process.env.SPACEVERSE_E2E_WORKFLOW==='true'?'true':'false'
process.env.ADMIN_ENABLE_ONBOARDING_POS_PROXY=process.env.SPACEVERSE_E2E_POS_PROXY==='true'?'true':'false'
process.env.ADMIN_PUBLIC_ORIGIN='http://127.0.0.1:5097'
process.env.ADMIN_CSRF_SECRET='synthetic-loopback-onboarding-csrf-secret-123456'
process.env.ADMIN_SECURE_COOKIES='false'
process.env.PIVNIK_APP_URL=''
process.env.BUSINESS_INTERNAL_TOKEN=''

// Deterministic provider fixture: exercises the real adapter without any live token,
// account, webhook, cash register or network request to Evotor.
const nativeFetch=globalThis.fetch
const devices=new Map<string,Awaited<ReturnType<typeof nativePosFixture>>>()
const proxyOrigins=new Map<string,string>()
const proxyRegistry:Record<string,string>={}
globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const target=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url)
  const deviceOrigin=proxyOrigins.get(target.origin)
  if(deviceOrigin)return nativeFetch(deviceOrigin+target.pathname+target.search,init)
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
const {loadSession}=await import('../../server/auth.js')
const {loadOwnedOnboardingRuntimeSource}=await import('../../server/venue-onboarding.js')
const root=fileURLToPath(new URL('../../dist/',import.meta.url))
const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'}
const server=http.createServer((req,res)=>{void (async()=>{
  const url=new URL(req.url!,'http://127.0.0.1:5097')
  if(process.env.SPACEVERSE_E2E_INVITATIONS==='true'&&req.method==='POST'&&url.pathname==='/__fixture/release/prepare'){
    // Synthetic predecessor records isolate the real code verification UI.
    // Schema/binding workers have separate real SQL tests; this never marks a
    // launched app, initializes customer data or contacts an external service.
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk))
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const session=await loadSession(req),source=await loadOwnedOnboardingRuntimeSource({query} as unknown as Pool,session.admin,body.draftId,true)
    for(const [step,result] of [['runtime_database_binding',{binding:'verified_existing'}],['tenant_schema_readiness',{schema:'verified',migrationSet:'009,017-020',ownershipBoundary:'verified'}]] as const){
      await db.query(`INSERT INTO admin_onboarding_provisioning_steps(draft_id,step,runtime_key,manifest_sha256,application_revision,company_id,venue_id,status,attempt_count,result)
        VALUES($1::uuid,$2,$3,$4,$5,$6::bigint,$7::bigint,'succeeded',1,$8::jsonb)
        ON CONFLICT(draft_id,step) DO NOTHING`,[source.draftId,step,source.manifest.runtimeKey,source.manifest.manifestSha256,source.manifest.source.applicationRevision,source.manifest.scope.companyId,source.manifest.scope.venueId,JSON.stringify(result)])
    }
    if(body.approved===true){
      // The optional actual local image evidence is test-process-only. Without
      // it this fixture uses explicitly synthetic inspection metadata.
      const imageFile=process.env.SPACEVERSE_E2E_IMAGE_INSPECTION_FILE
      const actualImage=imageFile?JSON.parse(await fs.readFile(imageFile,'utf8')):null
      const sourceSha=actualImage?.[0]?.Config?.Labels?.['org.opencontainers.image.revision']??'a'.repeat(40)
      const release=await createRuntimeRelease(fileURLToPath(new URL('../../../',import.meta.url)),sourceSha)
      const directory=await fs.mkdtemp(path.join(os.tmpdir(),'spaceverse-browser-release-')),file=path.join(directory,'release.json')
      await fs.writeFile(file,JSON.stringify(release))
      process.env.ADMIN_RUNTIME_RELEASE_SHA=release.sourceSha;process.env.ADMIN_RUNTIME_RELEASE_FINGERPRINT=release.fingerprint;process.env.ADMIN_RUNTIME_RELEASE_MANIFEST_FILE=file
      delete process.env.ADMIN_RUNTIME_IMAGE_ID;delete process.env.ADMIN_RUNTIME_IMAGE_INSPECTION_FILE
      if(body.imageApproved===true){
        const inspectionFile=path.join(directory,'image.json')
        await fs.writeFile(inspectionFile,JSON.stringify(actualImage??syntheticImageInspection(release)))
        process.env.ADMIN_RUNTIME_IMAGE_ID=actualImage?.[0]?.Id??syntheticImageId
        process.env.ADMIN_RUNTIME_IMAGE_INSPECTION_FILE=inspectionFile
      }
    }else{
      delete process.env.ADMIN_RUNTIME_RELEASE_SHA;delete process.env.ADMIN_RUNTIME_RELEASE_FINGERPRINT;delete process.env.ADMIN_RUNTIME_RELEASE_MANIFEST_FILE
      delete process.env.ADMIN_RUNTIME_IMAGE_ID;delete process.env.ADMIN_RUNTIME_IMAGE_INSPECTION_FILE
    }
    res.setHeader('Content-Type','application/json');res.end('{}');return
  }
  if(process.env.SPACEVERSE_E2E_POS_PROXY==='true'&&req.method==='POST'&&url.pathname.startsWith('/__fixture/pos/')){
    // Test-server-only controls, never imported by the Admin API or tenant app.
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk))
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if(url.pathname==='/__fixture/pos/create'){
      const device=await nativePosFixture(body.manifest,body.terminalId,body.storeId)
      devices.set(body.manifest.runtimeKey,device)
      const n=devices.size,reference='SPACEVERSE_TENANT_PROXY_ORIGIN_E2E_'+n,registered='https://proxy-'+n+'.fixture.invalid'
      proxyOrigins.set(registered,device.origin);proxyRegistry[body.manifest.runtimeKey]=reference
      process.env[reference]=registered;process.env.ADMIN_ONBOARDING_PROXY_REGISTRY_JSON=JSON.stringify(proxyRegistry)
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({storeId:device.storeId,deviceKey:device.deviceKey}));return
    }
    const device=devices.get(body.runtimeKey)
    if(!device){res.statusCode=404;res.end();return}
    if(url.pathname==='/__fixture/pos/event'){res.statusCode=(await device.event()).status;res.end('{}');return}
    if(url.pathname==='/__fixture/pos/sync'){await device.completeSync();res.end('{}');return}
    res.statusCode=404;res.end();return
  }
  if(await handleApi(req,res,url)) return
  const relative=url.pathname==='/'?'index.html':url.pathname.slice(1)
  const file=path.resolve(root,relative)
  if(!file.startsWith(root)||url.pathname.startsWith('/api/')) {res.statusCode=404;res.end();return}
  res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream')
  res.end(await fs.readFile(file))
})().catch(error=>sendApiError(res,error,req))})
server.listen(5097,'127.0.0.1')
async function close() {server.close();await Promise.all([...devices.values()].map(device=>device.close()));await db.close();await Promise.all([pool.end(),readPool.end()]);process.exit(0)}
process.on('SIGTERM',()=>void close());process.on('SIGINT',()=>void close())
