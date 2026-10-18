import pg from 'pg'
import { config } from './config.js'
import { databaseConnectionOptions } from './database-transport.js'
const { Pool } = pg

export const pool = new Pool({
  ...databaseConnectionOptions(config.databaseUrl), max: 6,
  idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000,
  application_name: 'codex-admin-metadata',
})
export const readPool = new Pool({
  ...databaseConnectionOptions(config.readDatabaseUrl), max: 8,
  idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000,
  application_name: 'codex-admin-production-read',
  options: '-c default_transaction_read_only=on',
})
export const writePool = config.productionWriteDatabaseUrl ? new Pool({
  ...databaseConnectionOptions(config.productionWriteDatabaseUrl), max: 4,
  idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000,
  application_name: 'codex-admin-production-write',
}) : null

for (const [name,p] of [['metadata',pool],['read',readPool],['write',writePool]] as const) {
  p?.on('error', e => console.error(`Admin ${name} pool error:`, e.message))
}
export async function tableExists(tableName:string):Promise<boolean> {
  if (!/^[a-z_][a-z0-9_]*$/i.test(tableName)) return false
  const r=await pool.query<{exists:boolean}>(`SELECT to_regclass($1) IS NOT NULL AS exists`,[`public.${tableName}`])
  return Boolean(r.rows[0]?.exists)
}
export async function productionTableExists(tableName:string):Promise<boolean> {
  if (!/^[a-z_][a-z0-9_]*$/i.test(tableName)) return false
  const r=await readPool.query<{exists:boolean}>(`SELECT to_regclass($1) IS NOT NULL AS exists`,[`public.${tableName}`])
  return Boolean(r.rows[0]?.exists)
}
export async function closePool():Promise<void> {
  await Promise.allSettled([pool.end(), readPool.end(), writePool?.end()])
}
