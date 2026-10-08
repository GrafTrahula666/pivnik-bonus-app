import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config, validateRuntimeConfig } from './config.js'
import { closePool, pool } from './db.js'

const __filename=fileURLToPath(import.meta.url)
const migrationDir=path.resolve(path.dirname(__filename),'..','admin-migrations')

async function main(){
  validateRuntimeConfig()
  if(!config.allowMigrations)throw new Error('Admin migrations disabled. Set ADMIN_ALLOW_MIGRATIONS=true only after review.')
  const preflight=await pool.query<{bars:boolean}>(`SELECT to_regclass('public.bars') IS NOT NULL AS bars`)
  if(!preflight.rows[0]?.bars)throw new Error('Preflight failed: public.bars missing. Refusing to guess production schema.')
  await pool.query(`CREATE TABLE IF NOT EXISTS admin_schema_migrations(code TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
  const client=await pool.connect()
  try{
    await client.query(`SELECT pg_advisory_lock(hashtext('codex-admin-migrations-v1'))`)
    const files=(await fs.readdir(migrationDir)).filter(x=>/^\d+_.+\.sql$/i.test(x)).sort()
    for(const file of files){
      const sql=await fs.readFile(path.join(migrationDir,file),'utf8')
      const checksum=crypto.createHash('sha256').update(sql).digest('hex')
      const existing=await client.query<{checksum:string}>(`SELECT checksum FROM admin_schema_migrations WHERE code=$1`,[file])
      if(existing.rowCount){
        if(existing.rows[0]!.checksum!==checksum)throw new Error(`Migration checksum mismatch: ${file}`)
        console.log(`skip ${file}`);continue
      }
      console.log(`apply ${file}`)
      await client.query(sql)
      await client.query(`INSERT INTO admin_schema_migrations(code,checksum) VALUES($1,$2)`,[file,checksum])
    }
  }finally{
    await client.query(`SELECT pg_advisory_unlock(hashtext('codex-admin-migrations-v1'))`).catch(()=>undefined)
    client.release()
  }
}
main().then(async()=>{console.log('Admin migrations complete.');await closePool()}).catch(async e=>{console.error(e instanceof Error?e.message:e);await closePool().catch(()=>undefined);process.exitCode=1})
