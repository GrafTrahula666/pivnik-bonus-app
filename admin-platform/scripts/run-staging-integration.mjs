import { spawn } from 'node:child_process'
import {assertStagingDatabaseIsolation} from './staging-database-isolation.mjs'

const INTEGRATION_DATABASE='codex_admin_test_staging'

// Keep the direct staging:integration entry point as strict as staging:deploy.
const parsed=new URL(assertStagingDatabaseIsolation())
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
