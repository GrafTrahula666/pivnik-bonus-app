import fs from 'node:fs/promises'
import type {PoolClient} from 'pg'

// Fixed, reviewed migrations only. No filename, SQL or URL comes from HTTP.
// Keep their explicit transaction wrappers out of our ONE atomic transaction.
const migrations=[
  new URL('../tenant-migrations/001_customer_core.sql',import.meta.url),
  ...['009_spaceverse_tenant_attribution.sql','017_spaceverse_runtime_binding.sql',
    '018_spaceverse_runtime_scope_binding.sql','019_spaceverse_customer_ownership.sql',
    '020_spaceverse_customer_create_requests.sql'].map(name=>new URL('../../migrations/'+name,import.meta.url)),
]

export async function loadEmptyTenantMigrations():Promise<string[]> {
  return Promise.all(migrations.map(async url=>{
    const sql=await fs.readFile(url,'utf8')
    if(url.pathname.endsWith('/001_customer_core.sql')||url.pathname.endsWith('/009_spaceverse_tenant_attribution.sql'))return sql
    const match=/^(?:\s|--[^\n]*(?:\n|$))*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/.exec(sql)
    if(!match)throw new Error('Unexpected tenant migration transaction envelope')
    return match[1]!
  }))
}

// Conservative preflight: existing tables (even empty), views, sequences,
// routines, types, extra schemas, extensions and event triggers refuse adoption.
// Registry isolation is also required; URL comparison alone is not sufficient.
export async function bootstrapEmptyTenant(client:PoolClient,sql:readonly string[]):Promise<boolean> {
  const result=await client.query<{occupied:boolean}>(`SELECT (
    EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_(toast|temp)')
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_(toast|temp)')
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_(toast|temp)')
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema','public')
      AND nspname !~ '^pg_(toast|temp)')
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_extension WHERE extname<>'plpgsql')
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_event_trigger)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_foreign_server)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE relnamespace=pg_catalog.pg_my_temp_schema())
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_largeobject_metadata)
  ) AS occupied`)
  if(result.rows[0]?.occupied!==false)return false
  await client.query("SET LOCAL spaceverse.empty_database_bootstrap='approved'")
  for(const migration of sql)await client.query(migration)
  return true
}
