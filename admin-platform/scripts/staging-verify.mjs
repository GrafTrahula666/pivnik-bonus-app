import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'

const { Client } = pg
const STAGING_PROJECT_ID='472996fe-c85d-4bda-bb72-2c96f7e5030f'
const STAGING_SERVICE_ID='c9441ae5-7fe9-4030-9b61-3cd8238f94f3'

if(process.env.RAILWAY_PROJECT_ID!==STAGING_PROJECT_ID||process.env.RAILWAY_SERVICE_ID!==STAGING_SERVICE_ID){
  throw new Error('Staging verification refused outside the isolated Admin staging service.')
}
const databaseUrl=String(process.env.ADMIN_DATABASE_URL||'')
if(!databaseUrl)throw new Error('ADMIN_DATABASE_URL is required.')

const writer=new Client({connectionString:databaseUrl,ssl:false})
const reader=new Client({connectionString:databaseUrl,ssl:false,options:'-c default_transaction_read_only=on'})
await writer.connect()
await reader.connect()
try{
  const guard=await writer.query(`SELECT project_id,service_id FROM admin_staging_guard WHERE project_id=$1`,[STAGING_PROJECT_ID])
  if(guard.rows[0]?.service_id!==STAGING_SERVICE_ID)throw new Error('Staging guard mismatch.')

  const files=(await fs.readdir(path.resolve('admin-migrations'))).filter(file=>/^\d+_.+\.sql$/i.test(file)).sort()
  const applied=await writer.query(`SELECT code,checksum FROM admin_schema_migrations ORDER BY code`)
  if(applied.rowCount!==files.length)throw new Error(`Migration count mismatch: expected ${files.length}, found ${applied.rowCount}.`)
  for(const file of files){
    const sql=await fs.readFile(path.resolve('admin-migrations',file),'utf8')
    const checksum=crypto.createHash('sha256').update(sql).digest('hex')
    const row=applied.rows.find(item=>item.code===file)
    if(!row||row.checksum!==checksum)throw new Error(`Migration checksum mismatch: ${file}`)
  }

  const tenants=await writer.query(`
    SELECT c.code AS company_code,c.name AS company_name,v.code AS venue_code,v.name AS venue_name,v.legacy_bar_id::text
    FROM companies c JOIN venues v ON v.company_id=c.id
    WHERE c.code IN('pivnik','north-hospitality') ORDER BY c.code
  `)
  const expected=[
    ['north-hospitality','NORTH HOSPITALITY','north-bar','NORTH BAR'],
    ['pivnik','ПИВНИК TEST','pivnik','ПИВНИК TEST VENUE'],
  ]
  if(tenants.rows.length!==2)throw new Error('Expected exactly two staging tenants.')
  for(let index=0;index<expected.length;index+=1){
    const row=tenants.rows[index],values=expected[index]
    if(!row||row.company_code!==values[0]||row.company_name!==values[1]||row.venue_code!==values[2]||row.venue_name!==values[3]||!row.legacy_bar_id){
      throw new Error(`Staging tenant mismatch at index ${index}.`)
    }
  }

  const indexes=['idx_admin_accounts_email_lower','idx_admin_sessions_expiry','idx_admin_audit_tenant_time','idx_loyalty_levels_venue','idx_wheel_prizes_venue','idx_admin_idempotency_created']
  const indexResult=await writer.query(`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname=ANY($1::text[])`,[indexes])
  if(indexResult.rowCount!==indexes.length)throw new Error('Required Admin indexes are missing.')

  const constraints=await writer.query(`
    SELECT COUNT(*)::int AS count FROM pg_constraint
    WHERE connamespace='public'::regnamespace
      AND conrelid=ANY(ARRAY['venues'::regclass,'admin_accounts'::regclass,'loyalty_levels'::regclass,'wheel_prizes'::regclass,'promotion_configs'::regclass])
  `)
  if(Number(constraints.rows[0]?.count||0)<12)throw new Error('Required Admin constraints are missing.')

  const readOnly=await reader.query('SHOW default_transaction_read_only')
  if(readOnly.rows[0]?.default_transaction_read_only!=='on')throw new Error('Read connection is not transaction-read-only.')
  let writeRejected=false
  try{await reader.query(`UPDATE companies SET updated_at=NOW() WHERE code='pivnik'`)}catch{writeRejected=true}
  if(!writeRejected)throw new Error('Read connection unexpectedly accepted a write.')

  const counts=await writer.query(`
    SELECT
      (SELECT COUNT(*)::int FROM admin_accounts WHERE active=TRUE) AS admins,
      (SELECT COUNT(*)::int FROM users WHERE username LIKE 'pivnik_test_%' OR username LIKE 'north_test_%') AS synthetic_customers,
      (SELECT COUNT(*)::int FROM wheel_prizes) AS wheel_prizes,
      (SELECT COUNT(*)::int FROM shop_item_configs) AS shop_items
  `)
  console.log('STAGING_SCHEMA_VERIFY PASS',JSON.stringify({migrations:files.length,...counts.rows[0]}))
}finally{
  await Promise.allSettled([writer.end(),reader.end()])
}
