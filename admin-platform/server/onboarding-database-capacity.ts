import type {PoolClient,QueryResultRow} from 'pg'
import type {SpaceverseRuntimeManifest} from '../../spaceverse-runtime-manifest.js'
import type {CapacitySlot} from './onboarding-database-registry.js'
import {recordAudit} from './audit.js'
import {HttpError,type AdminPrincipal,type VenueScope} from './types.js'

interface Allocation extends QueryResultRow {
  slot_key:string;target_fingerprint:string;runtime_key:string;manifest_sha256:string;
  application_revision:number;company_id:string;venue_id:string
}
const unavailable=()=>new HttpError(503,'ONBOARDING_DATABASE_CAPACITY_UNAVAILABLE',
  'Не удалось подтвердить резерв выделенной базы. Обновите состояние и повторите попытку.')

// Called within the existing binding claim transaction, after account/grant /
// frozen source locks. No target connection or external I/O under this lock.
export async function reserveDatabaseSlot(client:PoolClient,admin:AdminPrincipal,
  source:{draftId:string;manifest:SpaceverseRuntimeManifest;auditScope:VenueScope},slots:readonly CapacitySlot[]
):Promise<'reserved'|'exhausted'|'unavailable'> {
  const manifest=source.manifest
  await client.query("SET LOCAL lock_timeout='3s'")
  await client.query('SELECT pg_catalog.pg_advisory_xact_lock(7346189201302::bigint)')
  const existing=await client.query<Allocation>(`SELECT slot_key,target_fingerprint,runtime_key,manifest_sha256,
    application_revision,company_id::text,venue_id::text FROM admin_onboarding_database_allocations
    WHERE draft_id=$1::uuid FOR UPDATE`,[source.draftId])
  if(existing.rows.length){
    const row=existing.rows[0]!
    if(row.runtime_key!==manifest.runtimeKey||row.manifest_sha256!==manifest.manifestSha256||
      Number(row.application_revision)!==manifest.source.applicationRevision||row.company_id!==manifest.scope.companyId||row.venue_id!==manifest.scope.venueId)
      throw new HttpError(409,'ONBOARDING_DATABASE_CAPACITY_SOURCE_CHANGED','Резерв базы не соответствует сохранённой области. Обратитесь в поддержку.')
    return slots.some(slot=>slot.slotKey===row.slot_key&&slot.targetFingerprint===row.target_fingerprint)?'reserved':'unavailable'
  }
  const reserved=await client.query<{slot_key:string;target_fingerprint:string}>(
    'SELECT slot_key,target_fingerprint FROM admin_onboarding_database_allocations')
  const usedKeys=new Set(reserved.rows.map(row=>row.slot_key)),usedTargets=new Set(reserved.rows.map(row=>row.target_fingerprint))
  const slot=slots.find(slot=>!usedKeys.has(slot.slotKey)&&!usedTargets.has(slot.targetFingerprint))
  if(!slot)return 'exhausted'
  await client.query(`INSERT INTO admin_onboarding_database_allocations(draft_id,runtime_key,slot_key,target_fingerprint,
    manifest_sha256,application_revision,company_id,venue_id) VALUES($1::uuid,$2,$3,$4,$5,$6,$7::bigint,$8::bigint)`,[
    source.draftId,manifest.runtimeKey,slot.slotKey,slot.targetFingerprint,manifest.manifestSha256,
    manifest.source.applicationRevision,manifest.scope.companyId,manifest.scope.venueId,
  ])
  await recordAudit({admin,scope:source.auditScope,action:'onboarding.database_capacity_reserved',
    entityType:'onboarding_draft',entityId:source.draftId,metadata:{runtimeKey:manifest.runtimeKey},
  },client)
  return 'reserved'
}

// Only a resource lookup: does not reserve on GET/reads. Joined canonical rows
// prevent stale allocations from resolving after a revision/scope change.
export async function readAllocatedDatabaseSlot(runtimeKey:string):Promise<CapacitySlot|null>{
  if(!/^sv-[0-9a-f]{32}$/.test(runtimeKey))return null
  try{
    const {pool}=await import('./db.js')
    const result=await pool.query<{slot_key:string;target_fingerprint:string}>(`SELECT a.slot_key,a.target_fingerprint
      FROM admin_onboarding_database_allocations a
      JOIN admin_onboarding_app_configs app ON app.draft_id=a.draft_id AND app.tenant_key=a.runtime_key AND app.revision=a.application_revision
      JOIN admin_onboarding_scopes s ON s.draft_id=a.draft_id AND s.company_id=a.company_id AND s.venue_id=a.venue_id AND s.application_revision=a.application_revision
      JOIN venues v ON v.id=a.venue_id AND v.company_id=a.company_id AND v.code=a.runtime_key
      WHERE a.runtime_key=$1 LIMIT 2`,[runtimeKey])
    if(result.rows.length>1)throw unavailable()
    const row=result.rows[0]
    return row?{slotKey:row.slot_key,targetFingerprint:row.target_fingerprint}:null
  }catch{throw unavailable()}
}
