import { spawn } from 'node:child_process'

const STAGING_PROJECT_ID='472996fe-c85d-4bda-bb72-2c96f7e5030f'
const STAGING_SERVICE_ID='c9441ae5-7fe9-4030-9b61-3cd8238f94f3'
const INTEGRATION_DATABASE='codex_admin_test_staging'

if(process.env.RAILWAY_PROJECT_ID!==STAGING_PROJECT_ID||process.env.RAILWAY_SERVICE_ID!==STAGING_SERVICE_ID){
  throw new Error('Staging integration refused outside the isolated Admin staging service.')
}
if(process.env.ADMIN_ALLOW_TEST_SEED!=='true')throw new Error('ADMIN_ALLOW_TEST_SEED must be true for staging integration.')
const raw=String(process.env.ADMIN_DATABASE_URL||'')
if(!raw)throw new Error('ADMIN_DATABASE_URL is required.')
const parsed=new URL(raw)
if(!parsed.hostname.endsWith('.railway.internal'))throw new Error('Integration database must use the Railway private network.')
parsed.pathname=`/${INTEGRATION_DATABASE}`

const child=spawn(process.platform==='win32'?'npm.cmd':'npm',['run','test:integration'],{
  stdio:'inherit',
  env:{...process.env,ADMIN_INTEGRATION_TEST_DATABASE_URL:parsed.toString()},
})
const code=await new Promise((resolve,reject)=>{
  child.once('error',reject)
  child.once('exit',value=>resolve(value??1))
})
if(code!==0)process.exitCode=Number(code)
