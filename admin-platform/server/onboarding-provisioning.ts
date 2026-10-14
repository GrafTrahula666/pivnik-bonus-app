import crypto from 'node:crypto'
import type { Pool, PoolClient, QueryResultRow } from 'pg'
import { recordAudit } from './audit.js'
import { loadOwnedOnboardingRuntimeSource } from './venue-onboarding.js'
import { HttpError, type AdminPrincipal, type VenueScope } from './types.js'

const STEP='runtime_database_binding' as const
const LEASE_SECONDS=30
type StoredStatus='running'|'retryable_error'|'action_required'|'succeeded'
type VisibleStatus='not_started'|StoredStatus
type TargetResult={binding:'created'|'verified_existing'}

interface RuntimeManifest {
  runtimeKey:string
  manifestSha256:string
  source:{applicationRevision:number}
  scope:{companyId:string;venueId:string}
}
interface RuntimeSource {
  draftId:string
  manifest:RuntimeManifest
  auditScope:VenueScope
}
interface StepRow extends QueryResultRow {
  draft_id:string
  step:typeof STEP
  runtime_key:string
  manifest_sha256:string
  application_revision:number
  company_id:string
  venue_id:string
  status:StoredStatus
  attempt_count:number
  lease_token:string|null
  lease_expires_at:string|null
  lease_active:boolean
  last_error_code:string|null
  result:TargetResult|null
  created_at:string
  updated_at:string
}
type Connectable=Pick<Pool,'connect'>
type Client=PoolClient

export interface OnboardingProvisioningOptions {
  metadata:Connectable
  // Credentials stay server-side. A request can select only its frozen runtime
  // key; it can never provide a database URL, host or credential.
  resolveTargetDatabase:(runtimeKey:string)=>Promise<Connectable|null>
  afterTargetCommit?:(context:{draftId:string;runtimeKey:string})=>Promise<void>|void
}

class TargetStepFailure extends Error {
  constructor(readonly status:'retryable_error'|'action_required',readonly code:string) {
    super(code)
  }
}

const stepColumns=`draft_id::text,step,runtime_key,manifest_sha256,application_revision,
  company_id::text,venue_id::text,status,attempt_count,lease_token::text,
  lease_expires_at::text,(lease_expires_at IS NOT NULL AND lease_expires_at>NOW()) AS lease_active,
  last_error_code,result,created_at::text,updated_at::text`

const unavailable=()=>new HttpError(503,'ONBOARDING_PROVISIONING_UNAVAILABLE',
  'Не удалось подтвердить состояние подготовки приложения. Повторите попытку.')

function sourceValue(raw:Awaited<ReturnType<typeof loadOwnedOnboardingRuntimeSource>>):RuntimeSource {
  const manifest=raw.manifest as RuntimeManifest
  if(!manifest||typeof manifest.runtimeKey!=='string'||typeof manifest.manifestSha256!=='string'||
    !manifest.source||!Number.isSafeInteger(manifest.source.applicationRevision)||
    !manifest.scope||typeof manifest.scope.companyId!=='string'||typeof manifest.scope.venueId!=='string') {
    throw unavailable()
  }
  return {draftId:raw.draftId,manifest,auditScope:raw.auditScope}
}

function matchesSource(row:StepRow,source:RuntimeSource):boolean {
  return row.runtime_key===source.manifest.runtimeKey&&
    row.manifest_sha256===source.manifest.manifestSha256&&
    Number(row.application_revision)===source.manifest.source.applicationRevision&&
    row.company_id===source.manifest.scope.companyId&&row.venue_id===source.manifest.scope.venueId
}

function view(source:RuntimeSource,row?:StepRow) {
  const startAllowed=!row||row.status==='retryable_error'||row.status==='action_required'||
    (row.status==='running'&&!row.lease_active)
  return {
    draftId:source.draftId,
    step:STEP,
    runtimeKey:source.manifest.runtimeKey,
    manifestSha256:source.manifest.manifestSha256,
    applicationRevision:source.manifest.source.applicationRevision,
    scope:{companyId:source.manifest.scope.companyId,venueId:source.manifest.scope.venueId},
    status:(row?.status??'not_started') as VisibleStatus,
    attemptCount:Number(row?.attempt_count??0),
    errorCode:row?.last_error_code??null,
    result:row?.result??null,
    updatedAt:row?.updated_at??null,
    // The browser must not guess the server lease window from its own clock.
    // This flag exposes no target details and permits a retry only when claim()
    // would actually be allowed to reclaim the same idempotent step.
    startAllowed,
  }
}

async function connect(database:Connectable):Promise<Client> {
  try {return await database.connect()} catch {throw unavailable()}
}

async function selectStep(client:Pick<PoolClient,'query'>,draftId:string,lock=false):Promise<StepRow|undefined> {
  const result=await client.query<StepRow>(`SELECT ${stepColumns}
    FROM admin_onboarding_provisioning_steps
    WHERE draft_id=$1::uuid AND step=$2${lock?' FOR UPDATE':''}`,[draftId,STEP])
  return result.rows[0]
}

interface Claim {
  source:RuntimeSource
  row:StepRow
  token:string|null
}

async function claim(options:OnboardingProvisioningOptions,admin:AdminPrincipal,draftId:string):Promise<Claim> {
  const client=await connect(options.metadata)
  try {
    await client.query('BEGIN')
    const source=sourceValue(await loadOwnedOnboardingRuntimeSource(client,admin,draftId,true))
    const initialToken=crypto.randomUUID()
    const inserted=await client.query<{lease_token:string}>(`INSERT INTO admin_onboarding_provisioning_steps(
      draft_id,step,runtime_key,manifest_sha256,application_revision,company_id,venue_id,
      status,attempt_count,lease_token,lease_expires_at)
      VALUES($1::uuid,$2,$3,$4,$5,$6::bigint,$7::bigint,'running',1,$8::uuid,NOW()+INTERVAL '${LEASE_SECONDS} seconds')
      ON CONFLICT (draft_id,step) DO NOTHING RETURNING lease_token::text`,[
      source.draftId,STEP,source.manifest.runtimeKey,source.manifest.manifestSha256,
      source.manifest.source.applicationRevision,source.manifest.scope.companyId,source.manifest.scope.venueId,
      initialToken,
    ])
    let row=await selectStep(client,source.draftId,true)
    if(!row||!matchesSource(row,source)) {
      throw new HttpError(409,'ONBOARDING_PROVISIONING_SOURCE_CHANGED',
        'Подготовка уже связана с другой версией приложения. Проверьте сохранённую область.')
    }
    if(inserted.rows.length===1) {
      await client.query('COMMIT')
      return {source,row,token:initialToken}
    }
    if(row.status==='succeeded'||(row.status==='running'&&row.lease_active)) {
      await client.query('COMMIT')
      return {source,row,token:null}
    }
    const token=crypto.randomUUID()
    await client.query(`UPDATE admin_onboarding_provisioning_steps SET
      status='running',attempt_count=attempt_count+1,lease_token=$3::uuid,
      lease_expires_at=NOW()+INTERVAL '${LEASE_SECONDS} seconds',last_error_code=NULL,result=NULL,updated_at=NOW()
      WHERE draft_id=$1::uuid AND step=$2`,[source.draftId,STEP,token])
    row=await selectStep(client,source.draftId,true)
    if(!row) throw unavailable()
    await client.query('COMMIT')
    return {source,row,token}
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>undefined)
    if(error instanceof HttpError) throw error
    throw unavailable()
  } finally {client.release()}
}

interface BindingRow extends QueryResultRow {
  runtime_key:string
  manifest_sha256:string
  manifest_revision:number
  company_id:string|null
  venue_id:string|null
  isolation_policy:string
  status:string
}

function bindingMatches(row:BindingRow,source:RuntimeSource):boolean {
  return row.runtime_key===source.manifest.runtimeKey&&
    row.manifest_sha256===source.manifest.manifestSha256&&
    Number(row.manifest_revision)===source.manifest.source.applicationRevision&&
    row.company_id===source.manifest.scope.companyId&&row.venue_id===source.manifest.scope.venueId&&
    row.isolation_policy==='dedicated_database'&&row.status==='prepared'
}

async function bindTarget(database:Connectable,source:RuntimeSource):Promise<TargetResult> {
  let client:Client
  try {client=await database.connect()}
  catch {throw new TargetStepFailure('retryable_error','TARGET_DATABASE_UNAVAILABLE')}
  try {
    await client.query('BEGIN')
    const relation=await client.query<{table_name:string|null}>(
      "SELECT to_regclass('public.spaceverse_runtime_binding')::text AS table_name")
    if(!relation.rows[0]?.table_name) {
      throw new TargetStepFailure('action_required','TARGET_BINDING_SCHEMA_REQUIRED')
    }
    const columns=await client.query<{column_name:string}>(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='spaceverse_runtime_binding'`)
    const available=new Set(columns.rows.map(row=>row.column_name))
    const required=['runtime_key','manifest_sha256','manifest_revision','company_id','venue_id','isolation_policy','status']
    if(required.some(column=>!available.has(column))) {
      throw new TargetStepFailure('action_required','TARGET_BINDING_SCHEMA_REQUIRED')
    }
    const inserted=await client.query<BindingRow>(`INSERT INTO spaceverse_runtime_binding(
      singleton,runtime_key,manifest_sha256,manifest_revision,company_id,venue_id,isolation_policy,status)
      VALUES(TRUE,$1,$2,$3,$4,$5,'dedicated_database','prepared')
      ON CONFLICT (singleton) DO NOTHING
      RETURNING runtime_key,manifest_sha256,manifest_revision,company_id,venue_id,isolation_policy,status`,[
      source.manifest.runtimeKey,source.manifest.manifestSha256,source.manifest.source.applicationRevision,
      source.manifest.scope.companyId,source.manifest.scope.venueId,
    ])
    const current=await client.query<BindingRow>(`SELECT
      runtime_key,manifest_sha256,manifest_revision,company_id,venue_id,isolation_policy,status
      FROM spaceverse_runtime_binding WHERE singleton=TRUE FOR UPDATE`)
    if(current.rows.length!==1||!bindingMatches(current.rows[0]!,source)) {
      throw new TargetStepFailure('action_required','TARGET_BINDING_CONFLICT')
    }
    await client.query('COMMIT')
    return {binding:inserted.rows.length===1?'created':'verified_existing'}
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>undefined)
    if(error instanceof TargetStepFailure) throw error
    throw new TargetStepFailure('retryable_error','TARGET_DATABASE_UNAVAILABLE')
  } finally {client.release()}
}

async function finish(
  options:OnboardingProvisioningOptions,admin:AdminPrincipal,claimValue:Claim,
  outcome:{status:'succeeded';result:TargetResult}|{status:'retryable_error'|'action_required';errorCode:string},
) {
  const client=await connect(options.metadata)
  try {
    await client.query('BEGIN')
    const current=await selectStep(client,claimValue.source.draftId,true)
    if(!current) throw unavailable()
    // A worker that lost its lease can never overwrite a newer attempt. The
    // target binding is idempotent, so the newer worker will reconcile it.
    if(current.status!=='running'||current.lease_token!==claimValue.token) {
      await client.query('COMMIT')
      return view(claimValue.source,current)
    }
    if(outcome.status==='succeeded') {
      await client.query(`UPDATE admin_onboarding_provisioning_steps SET
        status='succeeded',lease_token=NULL,lease_expires_at=NULL,last_error_code=NULL,
        result=$3::jsonb,updated_at=NOW() WHERE draft_id=$1::uuid AND step=$2`,
      [claimValue.source.draftId,STEP,JSON.stringify(outcome.result)])
    } else {
      await client.query(`UPDATE admin_onboarding_provisioning_steps SET
        status=$3,lease_token=NULL,lease_expires_at=NULL,last_error_code=$4,result=NULL,updated_at=NOW()
        WHERE draft_id=$1::uuid AND step=$2`,
      [claimValue.source.draftId,STEP,outcome.status,outcome.errorCode])
    }
    const row=await selectStep(client,claimValue.source.draftId,true)
    if(!row) throw unavailable()
    await recordAudit({
      admin,scope:claimValue.source.auditScope,
      action:outcome.status==='succeeded'?'onboarding.provisioning_step_succeed':'onboarding.provisioning_step_error',
      entityType:'onboarding_provisioning_step',entityId:claimValue.source.draftId,
      before:{status:'running',attemptCount:current.attempt_count},
      after:{status:row.status,attemptCount:row.attempt_count},
      metadata:{step:STEP,...(outcome.status==='succeeded'?outcome.result:{errorCode:outcome.errorCode})},
    },client)
    await client.query('COMMIT')
    return view(claimValue.source,row)
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>undefined)
    if(error instanceof HttpError) throw error
    throw unavailable()
  } finally {client.release()}
}

export function createOnboardingProvisioningService(options:OnboardingProvisioningOptions) {
  if(!options?.metadata||typeof options.metadata.connect!=='function'||
    typeof options.resolveTargetDatabase!=='function') throw new TypeError('Invalid onboarding provisioning options')

  return Object.freeze({
    async getRuntimeDatabaseBinding(admin:AdminPrincipal,draftId:string) {
      const client=await connect(options.metadata)
      try {
        await client.query('BEGIN')
        const source=sourceValue(await loadOwnedOnboardingRuntimeSource(client,admin,draftId))
        const row=await selectStep(client,source.draftId)
        if(row&&!matchesSource(row,source)) {
          throw new HttpError(409,'ONBOARDING_PROVISIONING_SOURCE_CHANGED',
            'Подготовка уже связана с другой версией приложения. Проверьте сохранённую область.')
        }
        await client.query('COMMIT')
        return view(source,row)
      } catch(error) {
        await client.query('ROLLBACK').catch(()=>undefined)
        if(error instanceof HttpError) throw error
        throw unavailable()
      } finally {client.release()}
    },

    async runRuntimeDatabaseBinding(admin:AdminPrincipal,draftId:string) {
      const claimed=await claim(options,admin,draftId)
      if(!claimed.token) return view(claimed.source,claimed.row)
      try {
        const target=await options.resolveTargetDatabase(claimed.source.manifest.runtimeKey)
        if(!target) throw new TargetStepFailure('action_required','TARGET_DATABASE_NOT_REGISTERED')
        const result=await bindTarget(target,claimed.source)
        try {await options.afterTargetCommit?.({draftId:claimed.source.draftId,runtimeKey:claimed.source.manifest.runtimeKey})}
        catch {throw new TargetStepFailure('retryable_error','TARGET_CONFIRMATION_UNCERTAIN')}
        return await finish(options,admin,claimed,{status:'succeeded',result})
      } catch(error) {
        const failure=error instanceof TargetStepFailure?error:
          new TargetStepFailure('retryable_error','TARGET_DATABASE_UNAVAILABLE')
        return finish(options,admin,claimed,{status:failure.status,errorCode:failure.code})
      }
    },
  })
}
