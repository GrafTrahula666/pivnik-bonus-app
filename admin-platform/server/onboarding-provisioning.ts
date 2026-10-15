import crypto from 'node:crypto'
import type { Pool, PoolClient, QueryResultRow } from 'pg'
import {
  createSpaceverseRuntimeBundle,
  parseSpaceverseRuntimeBundle,
  parseSpaceverseRuntimeCodeRelease,
  parseSpaceverseRuntimeImageRelease,
  runtimeEnvironmentFromSpaceverseBundle,
  type SpaceverseRuntimeManifest,
  type SpaceverseRuntimeCodeRelease,
  type SpaceverseRuntimeImageRelease,
} from '../../spaceverse-runtime-manifest.js'
import { recordAudit } from './audit.js'
import { loadOwnedOnboardingRuntimeSource } from './venue-onboarding.js'
import { HttpError, type AdminPrincipal, type VenueScope } from './types.js'

const BINDING_STEP='runtime_database_binding' as const
const SCHEMA_READINESS_STEP='tenant_schema_readiness' as const
const RUNTIME_BUNDLE_STEP='runtime_bundle_verification' as const
const LEASE_SECONDS=30
type StepName=typeof BINDING_STEP|typeof SCHEMA_READINESS_STEP|typeof RUNTIME_BUNDLE_STEP
type StoredStatus='running'|'retryable_error'|'action_required'|'succeeded'
type VisibleStatus='not_started'|StoredStatus
type BindingResult={binding:'created'|'verified_existing'}
type SchemaReadinessResult={
  schema:'verified'
  migrationSet:'009,017-020'
  ownershipBoundary:'verified'
}
type RuntimeBundleResult={
  bundle:'verified'
  artifact:'pivnik-bonus-app'
  artifactContract:'tenant-runtime-v1'
  bundleSha256:string
  manifestSchemaVersion:2
  runtimeStatus:'not_provisioned'
  published:false
  codeRelease?:SpaceverseRuntimeCodeRelease
  imageRelease?:SpaceverseRuntimeImageRelease
}
type TargetResult=BindingResult|SchemaReadinessResult|RuntimeBundleResult

interface RuntimeSource {
  draftId:string
  manifest:SpaceverseRuntimeManifest
  auditScope:VenueScope
}
interface StepRow extends QueryResultRow {
  draft_id:string
  step:StepName
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
  // Tests and a future immutable artifact registry can supply a candidate, but
  // every candidate is parsed again with the runtime's shared strict contract.
  assembleRuntimeBundle?:(manifest:SpaceverseRuntimeManifest)=>Promise<unknown>|unknown
  requireCodeRelease?:boolean
  requireImageRelease?:boolean
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
  const manifest=raw.manifest as SpaceverseRuntimeManifest
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

function codePinned(row:StepRow){
  const value=row.result&&'codeRelease' in row.result?row.result.codeRelease:null
  try{return Boolean(value&&parseSpaceverseRuntimeCodeRelease(value))}catch{return false}
}
function missingProof(row:StepRow,options:OnboardingProvisioningOptions){
  if((options.requireCodeRelease||options.requireImageRelease)&&!codePinned(row))return 'RUNTIME_RELEASE_NOT_REGISTERED'
  if(options.requireImageRelease){
    const value=row.result&&'imageRelease' in row.result?row.result.imageRelease:null
    try{if(value&&parseSpaceverseRuntimeImageRelease(value))return null}catch{/* invalid persisted image proof */}
    return 'RUNTIME_IMAGE_NOT_REGISTERED'
  }
  return null
}
function view(source:RuntimeSource,step:StepName,row?:StepRow,options?:OnboardingProvisioningOptions) {
  const errorCode=options&&step===RUNTIME_BUNDLE_STEP&&row?.status==='succeeded'?missingProof(row,options):null
  if(errorCode){
    row={...row!,status:'action_required',last_error_code:errorCode,result:null}
  }
  const startAllowed=!row||row.status==='retryable_error'||row.status==='action_required'||
    (row.status==='running'&&!row.lease_active)
  return {
    draftId:source.draftId,
    step,
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

async function selectStep(client:Pick<PoolClient,'query'>,draftId:string,step:StepName,lock=false):Promise<StepRow|undefined> {
  const result=await client.query<StepRow>(`SELECT ${stepColumns}
    FROM admin_onboarding_provisioning_steps
    WHERE draft_id=$1::uuid AND step=$2${lock?' FOR UPDATE':''}`,[draftId,step])
  return result.rows[0]
}

interface Claim {
  source:RuntimeSource
  step:StepName
  row:StepRow
  token:string|null
}

async function claim(options:OnboardingProvisioningOptions,admin:AdminPrincipal,draftId:string,step:StepName):Promise<Claim> {
  const client=await connect(options.metadata)
  try {
    await client.query('BEGIN')
    const source=sourceValue(await loadOwnedOnboardingRuntimeSource(client,admin,draftId,true))
    if(step!==BINDING_STEP) {
      const dependencyStep=step===SCHEMA_READINESS_STEP?BINDING_STEP:SCHEMA_READINESS_STEP
      const dependency=await selectStep(client,source.draftId,dependencyStep,true)
      if(!dependency||!matchesSource(dependency,source)||dependency.status!=='succeeded') {
        throw new HttpError(409,'ONBOARDING_PROVISIONING_DEPENDENCY_REQUIRED',
          step===SCHEMA_READINESS_STEP?'Сначала подготовьте точную привязку выделенной базы приложения.':
            'Сначала подтвердите схему и ownership-границы выделенной базы приложения.')
      }
    }
    const initialToken=crypto.randomUUID()
    const inserted=await client.query<{lease_token:string}>(`INSERT INTO admin_onboarding_provisioning_steps(
      draft_id,step,runtime_key,manifest_sha256,application_revision,company_id,venue_id,
      status,attempt_count,lease_token,lease_expires_at)
      VALUES($1::uuid,$2,$3,$4,$5,$6::bigint,$7::bigint,'running',1,$8::uuid,NOW()+INTERVAL '${LEASE_SECONDS} seconds')
      ON CONFLICT (draft_id,step) DO NOTHING RETURNING lease_token::text`,[
      source.draftId,step,source.manifest.runtimeKey,source.manifest.manifestSha256,
      source.manifest.source.applicationRevision,source.manifest.scope.companyId,source.manifest.scope.venueId,
      initialToken,
    ])
    let row=await selectStep(client,source.draftId,step,true)
    if(!row||!matchesSource(row,source)) {
      throw new HttpError(409,'ONBOARDING_PROVISIONING_SOURCE_CHANGED',
        'Подготовка уже связана с другой версией приложения. Проверьте сохранённую область.')
    }
    if(inserted.rows.length===1) {
      await client.query('COMMIT')
      return {source,step,row,token:initialToken}
    }
    const oldDescriptor=step===RUNTIME_BUNDLE_STEP&&row.status==='succeeded'&&Boolean(missingProof(row,options))
    if((row.status==='succeeded'&&!oldDescriptor)||(row.status==='running'&&row.lease_active)) {
      await client.query('COMMIT')
      return {source,step,row,token:null}
    }
    const token=crypto.randomUUID()
    await client.query(`UPDATE admin_onboarding_provisioning_steps SET
      status='running',attempt_count=attempt_count+1,lease_token=$3::uuid,
      lease_expires_at=NOW()+INTERVAL '${LEASE_SECONDS} seconds',last_error_code=NULL,result=NULL,updated_at=NOW()
      WHERE draft_id=$1::uuid AND step=$2`,[source.draftId,step,token])
    row=await selectStep(client,source.draftId,step,true)
    if(!row) throw unavailable()
    await client.query('COMMIT')
    return {source,step,row,token}
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

interface SchemaColumnRow extends QueryResultRow {
  table_name:string
  column_name:string
  udt_name:string
}
interface SchemaConstraintRow extends QueryResultRow {
  table_name:string
  conname:string
  convalidated:boolean
  definition:string
}
interface SchemaIndexRow extends QueryResultRow {
  tablename:string
  indexdef:string
}

const requiredSchemaColumns:Record<string,Record<string,string>>={
  spaceverse_runtime_binding:{
    singleton:'bool',runtime_key:'text',manifest_sha256:'text',manifest_revision:'int4',
    company_id:'text',venue_id:'text',isolation_policy:'text',status:'text',
  },
  users:{
    id:'int8',telegram_id:'int8',username:'text',first_name:'text',last_name:'text',photo_url:'text',
    role:'text',session_version:'int8',deleted_at:'timestamptz',merged_into_user_id:'int8',
  },
  user_identities:{id:'int8',user_id:'int8',provider:'text',provider_user_id:'text',provider_username:'text'},
  wallets:{user_id:'int8',balance:'int8',updated_at:'timestamptz'},
  transactions:{id:'int8',request_key:'text',client_id:'int8',mode:'text',status:'text',tenant_id:'text',location_id:'text'},
  spaceverse_customer_ownership:{user_id:'int8',runtime_key:'text',company_id:'text',venue_id:'text'},
  spaceverse_customer_create_requests:{
    runtime_key:'text',request_key:'uuid',request_fingerprint:'text',company_id:'text',venue_id:'text',
    user_id:'int8',completed_at:'timestamptz',
  },
}

const normalizedSql=(value:string)=>value.toLowerCase().replaceAll('"','').replace(/\s+/g,' ').trim()

function hasDefinition(rows:SchemaConstraintRow[],table:string,pattern:RegExp):boolean {
  return rows.some(row=>row.table_name===table&&row.convalidated&&pattern.test(normalizedSql(row.definition)))
}

function hasUniqueIndex(rows:SchemaIndexRow[],table:string,columns:string):boolean {
  return rows.some(row=>row.tablename===table&&
    /^create unique index\b/.test(normalizedSql(row.indexdef))&&
    normalizedSql(row.indexdef).includes(`(${columns})`))
}

async function verifyTargetSchema(database:Connectable,source:RuntimeSource):Promise<SchemaReadinessResult> {
  let client:Client
  try {client=await database.connect()}
  catch {throw new TargetStepFailure('retryable_error','TARGET_DATABASE_UNAVAILABLE')}
  try {
    await client.query('BEGIN READ ONLY')
    const binding=await client.query<BindingRow>(`SELECT
      runtime_key,manifest_sha256,manifest_revision,company_id,venue_id,isolation_policy,status
      FROM spaceverse_runtime_binding WHERE singleton=TRUE`)
    if(binding.rows.length!==1||!bindingMatches(binding.rows[0]!,source)) {
      throw new TargetStepFailure('action_required','TARGET_BINDING_CONFLICT')
    }

    const columns=await client.query<SchemaColumnRow>(`SELECT table_name,column_name,udt_name
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name IN (
        'spaceverse_runtime_binding','users','user_identities','wallets','transactions',
        'spaceverse_customer_ownership','spaceverse_customer_create_requests'
      )`)
    const available=new Map(columns.rows.map(row=>[`${row.table_name}.${row.column_name}`,row.udt_name]))
    for(const [table,required] of Object.entries(requiredSchemaColumns)) {
      for(const [column,type] of Object.entries(required)) {
        if(available.get(`${table}.${column}`)!==type) {
          throw new TargetStepFailure('action_required','TARGET_TENANT_SCHEMA_REQUIRED')
        }
      }
    }

    const constraints=await client.query<SchemaConstraintRow>(`SELECT
      conrelid::regclass::text AS table_name,conname,convalidated,
      pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE conrelid IN (
        'public.users'::regclass,'public.user_identities'::regclass,'public.wallets'::regclass,
        'public.transactions'::regclass,'public.spaceverse_customer_ownership'::regclass,
        'public.spaceverse_customer_create_requests'::regclass
      )`)
    const definitions=constraints.rows
    const constraintChecks:[string,RegExp][]=[
      ['users',/^primary key \(id\)$/],
      ['wallets',/^primary key \(user_id\)$/],
      ['spaceverse_customer_ownership',/^primary key \(user_id\)$/],
      ['spaceverse_customer_ownership',/^foreign key \(user_id\) references users\(id\).*on delete cascade$/],
      ['spaceverse_customer_ownership',/^foreign key \(runtime_key, company_id, venue_id\) references spaceverse_runtime_binding\(runtime_key, company_id, venue_id\).*on update restrict on delete restrict$/],
      ['spaceverse_customer_create_requests',/^primary key \(runtime_key, request_key\)$/],
      ['spaceverse_customer_create_requests',/^foreign key \(runtime_key, company_id, venue_id\) references spaceverse_runtime_binding\(runtime_key, company_id, venue_id\).*on update restrict on delete restrict$/],
      ['spaceverse_customer_create_requests',/^check \(\(\(user_id is null\) = \(completed_at is null\)\)\)$/],
    ]
    if(constraintChecks.some(([table,pattern])=>!hasDefinition(definitions,table,pattern))) {
      throw new TargetStepFailure('action_required','TARGET_TENANT_SCHEMA_REQUIRED')
    }

    const indexes=await client.query<SchemaIndexRow>(`SELECT tablename,indexdef FROM pg_indexes
      WHERE schemaname='public' AND tablename IN (
        'spaceverse_runtime_binding','user_identities','transactions'
      )`)
    const indexChecks:[string,string][]=[
      ['spaceverse_runtime_binding','runtime_key, company_id, venue_id'],
      ['user_identities','provider, provider_user_id'],
      ['user_identities','user_id, provider'],
      ['transactions','request_key'],
    ]
    if(indexChecks.some(([table,columns])=>!hasUniqueIndex(indexes.rows,table,columns))) {
      throw new TargetStepFailure('action_required','TARGET_TENANT_SCHEMA_REQUIRED')
    }

    const ownership=await client.query<{ownership_gap:boolean}>(`WITH exact_ownership AS (
      SELECT user_id FROM spaceverse_customer_ownership
      WHERE runtime_key=$1 AND company_id=$2 AND venue_id=$3
    ), ownership_gaps AS (
      SELECT user_row.id AS user_id FROM users AS user_row
        WHERE NOT EXISTS (SELECT 1 FROM exact_ownership WHERE user_id=user_row.id)
      UNION ALL
      SELECT wallet.user_id FROM wallets AS wallet
        WHERE NOT EXISTS (SELECT 1 FROM exact_ownership WHERE user_id=wallet.user_id)
      UNION ALL
      SELECT identity.user_id FROM user_identities AS identity
        WHERE NOT EXISTS (SELECT 1 FROM exact_ownership WHERE user_id=identity.user_id)
      UNION ALL
      SELECT transaction.client_id FROM transactions AS transaction
        WHERE transaction.tenant_id IS DISTINCT FROM $2
           OR transaction.location_id IS DISTINCT FROM $3
           OR NOT EXISTS (SELECT 1 FROM exact_ownership WHERE user_id=transaction.client_id)
      UNION ALL
      SELECT request.user_id FROM spaceverse_customer_create_requests AS request
        WHERE request.runtime_key IS DISTINCT FROM $1
           OR request.company_id IS DISTINCT FROM $2
           OR request.venue_id IS DISTINCT FROM $3
           OR (request.user_id IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM exact_ownership WHERE user_id=request.user_id
           ))
    ) SELECT EXISTS(SELECT 1 FROM ownership_gaps) AS ownership_gap`,[
      source.manifest.runtimeKey,source.manifest.scope.companyId,source.manifest.scope.venueId,
    ])
    if(ownership.rows[0]?.ownership_gap!==false) {
      throw new TargetStepFailure('action_required','TARGET_TENANT_DATA_OWNERSHIP_REQUIRED')
    }
    await client.query('COMMIT')
    return {schema:'verified',migrationSet:'009,017-020',ownershipBoundary:'verified'}
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>undefined)
    if(error instanceof TargetStepFailure) throw error
    throw new TargetStepFailure('retryable_error','TARGET_DATABASE_UNAVAILABLE')
  } finally {client.release()}
}

async function verifyRuntimeBundle(
  options:OnboardingProvisioningOptions,source:RuntimeSource,
):Promise<RuntimeBundleResult> {
  try {
    const candidate=await (options.assembleRuntimeBundle??createSpaceverseRuntimeBundle)(source.manifest)
    const bundle=parseSpaceverseRuntimeBundle(candidate)
    if((options.requireCodeRelease||options.requireImageRelease)&&!bundle.artifact.codeRelease){
      throw new TargetStepFailure('action_required','RUNTIME_RELEASE_NOT_REGISTERED')
    }
    if(options.requireImageRelease&&!bundle.artifact.imageRelease){
      throw new TargetStepFailure('action_required','RUNTIME_IMAGE_NOT_REGISTERED')
    }
    const environment=runtimeEnvironmentFromSpaceverseBundle(bundle)
    if(environment.SPACEVERSE_RUNTIME_MODE!=='tenant'||
      environment.SPACEVERSE_RUNTIME_MANIFEST_JSON!==JSON.stringify(source.manifest)||
      bundle.manifest.manifestSha256!==source.manifest.manifestSha256) {
      throw new Error('Runtime bundle source mismatch')
    }
    return {
      bundle:'verified',artifact:'pivnik-bonus-app',artifactContract:'tenant-runtime-v1',
      bundleSha256:bundle.bundleSha256,manifestSchemaVersion:2,
      runtimeStatus:'not_provisioned',published:false,
      ...(bundle.artifact.codeRelease?{codeRelease:bundle.artifact.codeRelease}:{}),
      ...(bundle.artifact.imageRelease?{imageRelease:bundle.artifact.imageRelease}:{}),
    }
  } catch(error) {
    if(error instanceof TargetStepFailure)throw error
    const code=(error as {code?:string})?.code
    if(['RUNTIME_RELEASE_NOT_REGISTERED','RUNTIME_RELEASE_INVALID','RUNTIME_RELEASE_UNAVAILABLE','RUNTIME_RELEASE_MISMATCH',
      'RUNTIME_IMAGE_NOT_REGISTERED','RUNTIME_IMAGE_MISMATCH','RUNTIME_IMAGE_CONTRACT_INVALID'].includes(code??'')){
      throw new TargetStepFailure('action_required',code!)
    }
    throw new TargetStepFailure('action_required','RUNTIME_ARTIFACT_INCOMPATIBLE')
  }
}

async function finish(
  options:OnboardingProvisioningOptions,admin:AdminPrincipal,claimValue:Claim,
  outcome:{status:'succeeded';result:TargetResult}|{status:'retryable_error'|'action_required';errorCode:string},
) {
  const client=await connect(options.metadata)
  try {
    await client.query('BEGIN')
    const current=await selectStep(client,claimValue.source.draftId,claimValue.step,true)
    if(!current) throw unavailable()
    // A worker that lost its lease can never overwrite a newer attempt. The
    // target binding is idempotent, so the newer worker will reconcile it.
    if(current.status!=='running'||current.lease_token!==claimValue.token) {
      await client.query('COMMIT')
      return view(claimValue.source,claimValue.step,current,options)
    }
    if(outcome.status==='succeeded') {
      await client.query(`UPDATE admin_onboarding_provisioning_steps SET
        status='succeeded',lease_token=NULL,lease_expires_at=NULL,last_error_code=NULL,
        result=$3::jsonb,updated_at=NOW() WHERE draft_id=$1::uuid AND step=$2`,
      [claimValue.source.draftId,claimValue.step,JSON.stringify(outcome.result)])
    } else {
      await client.query(`UPDATE admin_onboarding_provisioning_steps SET
        status=$3,lease_token=NULL,lease_expires_at=NULL,last_error_code=$4,result=NULL,updated_at=NOW()
        WHERE draft_id=$1::uuid AND step=$2`,
      [claimValue.source.draftId,claimValue.step,outcome.status,outcome.errorCode])
    }
    const row=await selectStep(client,claimValue.source.draftId,claimValue.step,true)
    if(!row) throw unavailable()
    await recordAudit({
      admin,scope:claimValue.source.auditScope,
      action:outcome.status==='succeeded'?'onboarding.provisioning_step_succeed':'onboarding.provisioning_step_error',
      entityType:'onboarding_provisioning_step',entityId:claimValue.source.draftId,
      before:{status:'running',attemptCount:current.attempt_count},
      after:{status:row.status,attemptCount:row.attempt_count},
      metadata:{step:claimValue.step,...(outcome.status==='succeeded'?outcome.result:{errorCode:outcome.errorCode})},
    },client)
    await client.query('COMMIT')
    return view(claimValue.source,claimValue.step,row,options)
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
        const row=await selectStep(client,source.draftId,BINDING_STEP)
        if(row&&!matchesSource(row,source)) {
          throw new HttpError(409,'ONBOARDING_PROVISIONING_SOURCE_CHANGED',
            'Подготовка уже связана с другой версией приложения. Проверьте сохранённую область.')
        }
        await client.query('COMMIT')
        return view(source,BINDING_STEP,row)
      } catch(error) {
        await client.query('ROLLBACK').catch(()=>undefined)
        if(error instanceof HttpError) throw error
        throw unavailable()
      } finally {client.release()}
    },

    async runRuntimeDatabaseBinding(admin:AdminPrincipal,draftId:string) {
      const claimed=await claim(options,admin,draftId,BINDING_STEP)
      if(!claimed.token) return view(claimed.source,BINDING_STEP,claimed.row)
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

    async getTenantSchemaReadiness(admin:AdminPrincipal,draftId:string) {
      const client=await connect(options.metadata)
      try {
        await client.query('BEGIN')
        const source=sourceValue(await loadOwnedOnboardingRuntimeSource(client,admin,draftId))
        const dependency=await selectStep(client,source.draftId,BINDING_STEP)
        if(!dependency||!matchesSource(dependency,source)||dependency.status!=='succeeded') {
          throw new HttpError(409,'ONBOARDING_PROVISIONING_DEPENDENCY_REQUIRED',
            'Сначала подготовьте точную привязку выделенной базы приложения.')
        }
        const row=await selectStep(client,source.draftId,SCHEMA_READINESS_STEP)
        if(row&&!matchesSource(row,source)) {
          throw new HttpError(409,'ONBOARDING_PROVISIONING_SOURCE_CHANGED',
            'Подготовка уже связана с другой версией приложения. Проверьте сохранённую область.')
        }
        await client.query('COMMIT')
        return view(source,SCHEMA_READINESS_STEP,row)
      } catch(error) {
        await client.query('ROLLBACK').catch(()=>undefined)
        if(error instanceof HttpError) throw error
        throw unavailable()
      } finally {client.release()}
    },

    async runTenantSchemaReadiness(admin:AdminPrincipal,draftId:string) {
      const claimed=await claim(options,admin,draftId,SCHEMA_READINESS_STEP)
      if(!claimed.token) return view(claimed.source,SCHEMA_READINESS_STEP,claimed.row)
      try {
        const target=await options.resolveTargetDatabase(claimed.source.manifest.runtimeKey)
        if(!target) throw new TargetStepFailure('action_required','TARGET_DATABASE_NOT_REGISTERED')
        const result=await verifyTargetSchema(target,claimed.source)
        return await finish(options,admin,claimed,{status:'succeeded',result})
      } catch(error) {
        const failure=error instanceof TargetStepFailure?error:
          new TargetStepFailure('retryable_error','TARGET_DATABASE_UNAVAILABLE')
        return finish(options,admin,claimed,{status:failure.status,errorCode:failure.code})
      }
    },

    async getRuntimeBundleVerification(admin:AdminPrincipal,draftId:string) {
      const client=await connect(options.metadata)
      try {
        await client.query('BEGIN')
        const source=sourceValue(await loadOwnedOnboardingRuntimeSource(client,admin,draftId))
        const dependency=await selectStep(client,source.draftId,SCHEMA_READINESS_STEP)
        if(!dependency||!matchesSource(dependency,source)||dependency.status!=='succeeded') {
          throw new HttpError(409,'ONBOARDING_PROVISIONING_DEPENDENCY_REQUIRED',
            'Сначала подтвердите схему и ownership-границы выделенной базы приложения.')
        }
        const row=await selectStep(client,source.draftId,RUNTIME_BUNDLE_STEP)
        if(row&&!matchesSource(row,source)) {
          throw new HttpError(409,'ONBOARDING_PROVISIONING_SOURCE_CHANGED',
            'Подготовка уже связана с другой версией приложения. Проверьте сохранённую область.')
        }
        await client.query('COMMIT')
        return view(source,RUNTIME_BUNDLE_STEP,row,options)
      } catch(error) {
        await client.query('ROLLBACK').catch(()=>undefined)
        if(error instanceof HttpError) throw error
        throw unavailable()
      } finally {client.release()}
    },

    async runRuntimeBundleVerification(admin:AdminPrincipal,draftId:string) {
      const claimed=await claim(options,admin,draftId,RUNTIME_BUNDLE_STEP)
      if(!claimed.token) return view(claimed.source,RUNTIME_BUNDLE_STEP,claimed.row,options)
      try {
        const result=await verifyRuntimeBundle(options,claimed.source)
        return await finish(options,admin,claimed,{status:'succeeded',result})
      } catch(error) {
        const failure=error instanceof TargetStepFailure?error:
          new TargetStepFailure('action_required','RUNTIME_ARTIFACT_INCOMPATIBLE')
        return finish(options,admin,claimed,{status:failure.status,errorCode:failure.code})
      }
    },
  })
}
