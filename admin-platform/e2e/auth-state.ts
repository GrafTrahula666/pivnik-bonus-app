import fs from 'node:fs'
import path from 'node:path'
import type { BrowserContext } from '@playwright/test'

export type StoredState=Awaited<ReturnType<BrowserContext['storageState']>>

// The login limiter allows 6 attempts per account per 15 minutes, so the suite logs each account in once (global-setup.ts) and reuses the session.
export const authDir=path.resolve('e2e/.auth')

export function stateFile(email:string){
  return path.join(authDir,`${email.toLowerCase().replace(/[^a-z0-9]+/g,'_')}.json`)
}

export function readState(email:string):StoredState{
  const file=stateFile(email)
  if(!fs.existsSync(file))throw new Error(`E2E session for ${email} is missing; global setup did not log it in`)
  return JSON.parse(fs.readFileSync(file,'utf8')) as StoredState
}
