// Loopback-only: built App, real signed sessions and the same isolated SQL fixture
// as HTTP regression. No provider, Railway, live credentials or production DB.
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'

process.env.NODE_ENV='development'
process.env.ADMIN_DATABASE_URL=''
process.env.ADMIN_READ_DATABASE_URL=''
process.env.ADMIN_PRODUCTION_WRITE_DATABASE_URL=''
process.env.ADMIN_ENABLE_WRITES='true'
process.env.ADMIN_ENABLE_ONBOARDING_DRAFTS='true'
process.env.ADMIN_ENABLE_ONBOARDING_INVITATIONS='true'
process.env.ADMIN_ENABLE_ONBOARDING_WORKFLOW='true'
process.env.ADMIN_ENABLE_ONBOARDING_SUPPORT=process.env.SPACEVERSE_E2E_SUPPORT==='true'?'true':'false'
process.env.ADMIN_ENABLE_ONBOARDING_INTEGRATIONS='false'
process.env.ADMIN_ENABLE_ONBOARDING_PROVISIONING='false'
process.env.ADMIN_ENABLE_ONBOARDING_POS_PROXY='false'
process.env.ADMIN_ENABLE_TENANT_CRM_READS=process.env.SPACEVERSE_E2E_CRM_READS==='false'?'false':'true'
process.env.ADMIN_ENABLE_TENANT_CRM_ACTIVATION_CHECKS=process.env.SPACEVERSE_E2E_CRM_ACTIVATION==='true'?'true':'false'
process.env.ADMIN_ENABLE_CRM_ONBOARDING=process.env.SPACEVERSE_E2E_CRM_PREPARATION==='true'||process.env.SPACEVERSE_E2E_SUPPORT==='true'?'true':'false'
process.env.ADMIN_PUBLIC_ORIGIN='http://127.0.0.1:5101'
process.env.ADMIN_CSRF_SECRET='synthetic-loopback-tenant-crm-csrf-secret-123456'
process.env.ADMIN_SECURE_COOKIES='false'
process.env.PIVNIK_APP_URL=''
process.env.BUSINESS_INTERNAL_TOKEN=''

// Seed in a separate process before config/registry singletons load. The real
// registry remains frozen and uses real pg pools, not a replacement implementation.
const seeded=spawnSync(process.execPath,['--import','tsx','e2e/fixtures/tenant-crm-seed.ts'],{
  cwd:fileURLToPath(new URL('../../',import.meta.url)),env:process.env,encoding:'utf8',timeout:60_000,
})
if(seeded.status!==0)throw new Error('CRM browser fixture requires SPACEVERSE_TEST_NATIVE_POSTGRES_URL pointing at the dedicated local crm_fixture test cluster.')
const fixture=JSON.parse(seeded.stdout) as {metadataUrl:string;registry:Record<string,{credentialEnv:string}>;targets:Record<string,string>}
process.env.ADMIN_DATABASE_URL=fixture.metadataUrl
process.env.ADMIN_READ_DATABASE_URL=fixture.metadataUrl
process.env.ADMIN_ONBOARDING_DATABASE_REGISTRY_JSON=JSON.stringify(fixture.registry)
for(const [name,url] of Object.entries(fixture.targets))process.env[name]=url
const {pool,readPool}=await import('../../server/db.js')
const {closeOnboardingTargetRegistry}=await import('../../server/onboarding-database-registry.js')
const {handleApi,sendApiError}=await import('../../server/router.js')
const root=path.resolve(fileURLToPath(new URL('../../dist/',import.meta.url)))
const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'}
const server=http.createServer((req,res)=>{void(async()=>{
  const url=new URL(req.url||'/','http://127.0.0.1:5101')
  if(await handleApi(req,res,url))return
  const file=path.resolve(root,url.pathname==='/'?'index.html':url.pathname.slice(1))
  if(!file.startsWith(root+path.sep)||url.pathname.startsWith('/api/')){res.statusCode=404;res.end();return}
  res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream')
  res.end(await fs.readFile(file))
})().catch(error=>sendApiError(res,error,req))})
server.listen(5101,'127.0.0.1')
async function close(){
  await new Promise<void>(resolve=>server.close(()=>resolve()))
  await closeOnboardingTargetRegistry();await pool.end();await readPool.end()
  process.exit(0)
}
process.on('SIGTERM',()=>void close());process.on('SIGINT',()=>void close())
