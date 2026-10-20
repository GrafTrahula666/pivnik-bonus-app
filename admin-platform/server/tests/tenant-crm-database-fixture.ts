import crypto from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import pg from 'pg'

export interface TenantCrmFixtureDatabase {
  readonly connectionString?:string
  query<Row=Record<string,unknown>>(text:string,params?:unknown[]):Promise<{rows:Row[];affectedRows?:number}>
  exec(text:string):Promise<unknown>
  close():Promise<unknown>
  connect?:()=>Promise<{
    query<Row=Record<string,unknown>>(text:string,params?:unknown[]):Promise<{rows:Row[];affectedRows?:number}>
    release():void
  }>
}

export async function tenantCrmFixtureDatabase():Promise<TenantCrmFixtureDatabase> {
  const raw=String(process.env.SPACEVERSE_TEST_NATIVE_POSTGRES_URL||'')
  if(!raw)return new PGlite()
  const url=new URL(raw)
  if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost'].includes(url.hostname)||
    !/^\/codex_admin_test(?:_|$)/.test(url.pathname)||url.username!=='crm_fixture') {
    throw new Error('Native CRM tests require the dedicated local crm_fixture test cluster.')
  }
  const name='codex_admin_test_crm_'+crypto.randomUUID().replaceAll('-','')
  const control=new pg.Pool({connectionString:url.href,ssl:false,max:1})
  try {
    // Identifier is generated here, never taken from a URL/request. Separate
    // physical databases preserve the existing dedicated_database boundary.
    await control.query(`CREATE DATABASE "${name}"`)
  } finally {await control.end()}
  url.pathname='/'+name
  const pool=new pg.Pool({connectionString:url.href,ssl:false,max:2})
  return {
    connectionString:url.href,
    async query<Row=Record<string,unknown>>(text:string,params?:unknown[]) {
      const result=await pool.query(text,params)
      return {rows:result.rows as Row[],affectedRows:result.rowCount??0}
    },
    exec:async text=>{await pool.query(text)},
    async connect() {
      const client=await pool.connect()
      return {
        async query<Row=Record<string,unknown>>(text:string,params?:unknown[]) {
          const result=await client.query(text,params)
          return {rows:result.rows as Row[],affectedRows:result.rowCount??0}
        },
        release:()=>client.release(),
      }
    },
    // Retain fixture databases for inspection; no DROP of another run's data.
    close:()=>pool.end(),
  }
}
