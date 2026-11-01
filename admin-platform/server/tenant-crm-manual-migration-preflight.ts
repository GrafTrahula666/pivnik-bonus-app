// CHAT 03 / #24: read-only, unmounted migration 002 acceptance preflight.
// It MUST NOT apply SQL, set approval flags, resolve credentials or infer
// ownership. The caller must independently verify the canonical Admin owner
// and registry-isolated target, then supply an exact trusted manifest.
export type ManualCrmMigrationExpectation={
  databaseName:string
  runtimeKey:string
  manifestSha256:string
  manifestRevision:number
  companyId:string
  venueId:string
}
type Reader={query<Row=Record<string,unknown>>(sql:string,params?:unknown[]):Promise<{rows:Row[]}>}
type Inventory={
  database_name:string
  schema_name:string
  runtime_binding:boolean
  ownership:boolean
  scope_index:boolean
  users:boolean
  contacts:boolean
  request_ledger:boolean
}
type Binding={
  runtime_key:string
  manifest_sha256:string
  manifest_revision:number
  company_id:string|null
  venue_id:string|null
  isolation_policy:string
  status:string
}
const runtimeKeyPattern=/^sv-[0-9a-f]{32}$/
const shaPattern=/^[0-9a-f]{64}$/
const idPattern=/^[1-9][0-9]{0,18}$/
const databaseNamePattern=/^[a-zA-Z0-9_-]{1,63}$/

export class ManualCrmMigrationPreflightError extends Error {
  constructor(readonly code:string){
    super('Manual CRM migration preflight refused: '+code)
    this.name='ManualCrmMigrationPreflightError'
  }
}
const refused=(code:string):never=>{throw new ManualCrmMigrationPreflightError(code)}

/**
 * SELECT-only target inspection. A positive result is NOT consent to migrate,
 * a production ownership proof, or permission to enable contact creation.
 * The caller must use the existing isolated target registry and verify the
 * expected manifest against locked Admin metadata outside this routine.
 */
export async function inspectManualCrmMigrationTarget(
  target:Reader,expected:ManualCrmMigrationExpectation,
):Promise<Readonly<{state:'review_required';databaseName:string;runtimeKey:string;
  companyId:string;venueId:string;manifestRevision:number;approvalGranted:false}>>{
  if(!expected||!databaseNamePattern.test(expected.databaseName)||
    !runtimeKeyPattern.test(expected.runtimeKey)||!shaPattern.test(expected.manifestSha256)||
    !Number.isSafeInteger(expected.manifestRevision)||expected.manifestRevision<=0||
    !idPattern.test(expected.companyId)||!idPattern.test(expected.venueId))
    refused('INVALID_EXPECTATION')

  // Always inspect the name and explicit public schema before reading a row.
  // A different schema/search_path must never receive CREATE TABLE implicitly.
  const inventory=await target.query<Inventory>(`SELECT
    current_database() AS database_name,
    current_schema() AS schema_name,
    to_regclass('public.spaceverse_runtime_binding') IS NOT NULL AS runtime_binding,
    to_regclass('public.spaceverse_customer_ownership') IS NOT NULL AS ownership,
    to_regclass('public.idx_spaceverse_runtime_binding_scope_key') IS NOT NULL AS scope_index,
    to_regclass('public.users') IS NOT NULL AS users,
    to_regclass('public.spaceverse_crm_contacts') IS NOT NULL AS contacts,
    to_regclass('public.spaceverse_crm_contact_create_requests') IS NOT NULL AS request_ledger`)
  if(inventory.rows.length!==1)refused('INVENTORY_UNAVAILABLE')
  const present=inventory.rows[0]!
  if(present.database_name!==expected.databaseName)refused('DATABASE_MISMATCH')
  if(present.schema_name!=='public')refused('SCHEMA_MISMATCH')
  if(!present.runtime_binding||!present.ownership||!present.scope_index||!present.users)
    refused('PREREQUISITES_MISSING')
  // Never use CREATE TABLE IF NOT EXISTS to guess whether a partial/mismatched
  // migration should be silently accepted. Require a separate schema audit.
  if(present.contacts||present.request_ledger)refused('MIGRATION_ALREADY_OR_PARTIALLY_PRESENT')

  const binding=await target.query<Binding>(`SELECT
    runtime_key,manifest_sha256,manifest_revision,company_id,venue_id,
    isolation_policy,status
    FROM public.spaceverse_runtime_binding WHERE singleton=TRUE`)
  if(binding.rows.length!==1)refused('BINDING_MISSING_OR_AMBIGUOUS')
  const actual=binding.rows[0]!
  if(actual.runtime_key!==expected.runtimeKey||
    actual.manifest_sha256!==expected.manifestSha256||
    Number(actual.manifest_revision)!==expected.manifestRevision||
    actual.company_id!==expected.companyId||actual.venue_id!==expected.venueId||
    actual.isolation_policy!=='dedicated_database'||actual.status!=='prepared')
    refused('BINDING_MISMATCH_OR_NOT_PREPARED')

  return Object.freeze({
    state:'review_required',databaseName:present.database_name,
    runtimeKey:actual.runtime_key,companyId:expected.companyId,
    venueId:expected.venueId,manifestRevision:expected.manifestRevision,
    approvalGranted:false,
  })
}
