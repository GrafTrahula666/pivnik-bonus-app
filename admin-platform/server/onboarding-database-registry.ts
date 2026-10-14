import crypto from 'node:crypto'
import pg, { type PoolConfig, type Pool as PgPool } from 'pg'
import { HttpError } from './types.js'

const { Pool } = pg
const runtimeKeyPattern=/^sv-[0-9a-f]{32}$/
const credentialEnvPattern=/^SPACEVERSE_TENANT_DATABASE_URL_[A-Z0-9_]{1,64}$/
const protectedDatabaseVariables=[
  'ADMIN_DATABASE_URL','ADMIN_READ_DATABASE_URL','ADMIN_PRODUCTION_WRITE_DATABASE_URL','DATABASE_URL',
] as const

type Connectable=Pick<PgPool,'connect'>
type RegistryPool=Connectable&{end:()=>Promise<void>;on?:(event:string,listener:(error:Error)=>void)=>unknown}
type RegistryEntry={credentialEnv:string}

export interface OnboardingTargetRegistryOptions {
  env?:NodeJS.ProcessEnv
  poolFactory?:(config:PoolConfig)=>RegistryPool
}

const invalidRegistry=()=>new HttpError(500,'ONBOARDING_DATABASE_REGISTRY_INVALID',
  'Защищённый реестр баз заведений настроен некорректно.')

function databaseIdentity(raw:string):string {
  try {
    const value=new URL(raw)
    if(!['postgres:','postgresql:'].includes(value.protocol)||!value.hostname||!value.pathname||value.pathname==='/') {
      throw invalidRegistry()
    }
    if(value.hash) throw invalidRegistry()
    const database=decodeURIComponent(value.pathname.slice(1))
    const hasControl=Array.from(database).some(character=>{
      const code=character.charCodeAt(0)
      return code<=31||code===127
    })
    if(!database||database.includes('/')||hasControl) throw invalidRegistry()
    return `${value.hostname.toLowerCase()}:${value.port||'5432'}/${database}`
  } catch(error) {
    if(error instanceof HttpError) throw error
    throw invalidRegistry()
  }
}

function parseEntries(raw:string):Map<string,RegistryEntry> {
  if(!raw.trim()) return new Map()
  let parsed:unknown
  try {parsed=JSON.parse(raw)} catch {throw invalidRegistry()}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)) throw invalidRegistry()
  const records=Object.entries(parsed as Record<string,unknown>)
  if(records.length>200) throw invalidRegistry()
  const entries=new Map<string,RegistryEntry>(),references=new Set<string>()
  for(const [runtimeKey,candidate] of records) {
    if(!runtimeKeyPattern.test(runtimeKey)||!candidate||typeof candidate!=='object'||Array.isArray(candidate)) {
      throw invalidRegistry()
    }
    const value=candidate as Record<string,unknown>
    if(Object.keys(value).length!==1||typeof value.credentialEnv!=='string'||
      !credentialEnvPattern.test(value.credentialEnv)||references.has(value.credentialEnv)) {
      throw invalidRegistry()
    }
    references.add(value.credentialEnv)
    entries.set(runtimeKey,{credentialEnv:value.credentialEnv})
  }
  return entries
}

function sslFor(raw:string):false|{rejectUnauthorized:true} {
  const host=new URL(raw).hostname.toLowerCase()
  return host==='localhost'||host==='127.0.0.1'||host.endsWith('.railway.internal')
    ? false:{rejectUnauthorized:true}
}

export function createOnboardingTargetRegistry(options:OnboardingTargetRegistryOptions={}) {
  const env=options.env??process.env
  const entries=parseEntries(String(env.ADMIN_ONBOARDING_DATABASE_REGISTRY_JSON??''))
  const poolFactory=options.poolFactory??((poolConfig:PoolConfig)=>new Pool(poolConfig) as RegistryPool)
  const pools=new Map<string,{fingerprint:string;pool:RegistryPool}>()
  const resolving=new Map<string,Promise<Connectable|null>>()

  const reservedIdentities=()=>new Set(protectedDatabaseVariables.flatMap(name=>{
    const value=String(env[name]??'').trim()
    return value?[databaseIdentity(value)]:[]
  }))
  const credential=(runtimeKey:string):{url:string;fingerprint:string;identity:string}|null=>{
    const entry=entries.get(runtimeKey)
    if(!entry) return null
    const url=String(env[entry.credentialEnv]??'').trim()
    if(!url) return null
    const identity=databaseIdentity(url)
    if(reservedIdentities().has(identity)) throw invalidRegistry()
    return {url,identity,fingerprint:crypto.createHash('sha256').update(url).digest('hex')}
  }
  const validateIsolation=()=>{
    const identities=new Set<string>()
    for(const runtimeKey of entries.keys()) {
      const current=credential(runtimeKey)
      if(!current) continue
      if(identities.has(current.identity)) throw invalidRegistry()
      identities.add(current.identity)
    }
    return {registered:entries.size}
  }
  const closeOne=async(runtimeKey:string)=>{
    const existing=pools.get(runtimeKey)
    if(!existing) return
    pools.delete(runtimeKey)
    await existing.pool.end().catch(()=>undefined)
  }
  const resolveOnce=async(runtimeKey:string):Promise<Connectable|null>=>{
    if(!runtimeKeyPattern.test(runtimeKey)) return null
    validateIsolation()
    const current=credential(runtimeKey)
    if(!current) {await closeOne(runtimeKey);return null}
    const existing=pools.get(runtimeKey)
    if(existing?.fingerprint===current.fingerprint) return existing.pool
    const target=poolFactory({
      connectionString:current.url,ssl:sslFor(current.url),max:2,
      idleTimeoutMillis:30_000,connectionTimeoutMillis:10_000,
      application_name:'spaceverse-onboarding-provisioner',
    })
    target.on?.('error',()=>console.error(`Onboarding target pool unavailable for ${runtimeKey}`))
    pools.set(runtimeKey,{fingerprint:current.fingerprint,pool:target})
    if(existing) await existing.pool.end().catch(()=>undefined)
    return target
  }

  return Object.freeze({
    validate() {
      return validateIsolation()
    },
    async resolveTargetDatabase(runtimeKey:string):Promise<Connectable|null> {
      const pending=resolving.get(runtimeKey)
      if(pending) return pending
      const operation=resolveOnce(runtimeKey).finally(()=>resolving.delete(runtimeKey))
      resolving.set(runtimeKey,operation)
      return operation
    },
    async close() {
      const active=[...pools.values()].map(item=>item.pool)
      pools.clear();resolving.clear()
      await Promise.allSettled(active.map(target=>target.end()))
    },
  })
}

export const onboardingTargetRegistry=createOnboardingTargetRegistry()
export const validateOnboardingTargetRegistry=()=>onboardingTargetRegistry.validate()
export const closeOnboardingTargetRegistry=()=>onboardingTargetRegistry.close()
