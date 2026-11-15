import { spawn } from 'node:child_process'
import { approvedStagingIntegrationDatabaseUrl } from './staging-database-isolation.mjs'

const integrationDatabaseUrl = approvedStagingIntegrationDatabaseUrl()

const child=spawn(process.platform==='win32'?'npm.cmd':'npm',['run','test:integration'],{
  stdio:'inherit',
  env:{...process.env,ADMIN_INTEGRATION_TEST_DATABASE_URL:integrationDatabaseUrl},
})
const code=await new Promise((resolve,reject)=>{
  child.once('error',reject)
  child.once('exit',value=>resolve(value??1))
})
if(code!==0)process.exitCode=Number(code)
