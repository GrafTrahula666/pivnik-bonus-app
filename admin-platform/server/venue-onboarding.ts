import crypto from 'node:crypto'
import type { PoolClient, QueryResultRow } from 'pg'
import { recordAudit } from './audit.js'
import { config } from './config.js'
import { pool } from './db.js'
import { requireSuperAdmin } from './tenant.js'
import { HttpError, type AdminPrincipal, type VenueScope } from './types.js'
import { createSpaceverseRuntimeManifest } from '../../spaceverse-runtime-manifest.js'

export interface OnboardingData {
  companyId: string | null
  companyName: string
  venueName: string
  address: string
  timeZone: string
  venueType: 'bar' | 'cafe' | 'restaurant' | 'shop' | 'other'
  ownerEmail: string
}
interface DraftRow extends QueryResultRow {
  id: string
  request_key: string
  initial_hash: string
  data: OnboardingData
  status: 'draft'
  revision: number
  updated_at: string
}
export interface OnboardingAppConfig {
  displayName: string
  theme: 'premium-dark' | 'dark' | 'light'
  primaryColor: string
  secondaryColor: string
  shopEnabled: boolean
  loyaltyEnabled: boolean
}
interface AppConfigRow extends QueryResultRow {
  draft_id: string
  tenant_key: string
  config: OnboardingAppConfig
  isolation_policy: 'dedicated_database'
  provisioning_status: 'not_started'
  revision: number
  updated_at: string
}
interface AppDraftRow extends QueryResultRow {
  id: string
}
interface ScopeRow extends QueryResultRow {
  draft_id: string
  company_id: string
  venue_id: string
  company_created_by_onboarding: boolean
  draft_revision: number
  application_revision: number
  status: 'prepared'
  revision: number
  updated_at: string
  company_code: string
  company_name: string
  company_active: boolean
  venue_company_id: string
  venue_code: string
  venue_name: string
  venue_address: string | null
  venue_active: boolean
}
const fields = ['companyId','companyName','venueName','address','timeZone','venueType','ownerEmail'] as const
const columns = 'id::text,request_key::text,initial_hash,data,status,revision,updated_at::text'
const appFields = ['displayName','theme','primaryColor','secondaryColor','shopEnabled','loyaltyEnabled'] as const
const appColumns = `draft_id::text,tenant_key,config,isolation_policy,provisioning_status,revision,updated_at::text`
const joinedAppColumns = `a.draft_id::text,a.tenant_key,a.config,a.isolation_policy,a.provisioning_status,a.revision,a.updated_at::text`
const joinedScopeColumns = `s.draft_id::text,s.company_id::text,s.venue_id::text,s.company_created_by_onboarding,
  s.draft_revision,s.application_revision,s.status,s.revision,s.updated_at::text,
  c.code AS company_code,c.name AS company_name,c.active AS company_active,
  v.company_id::text AS venue_company_id,v.code AS venue_code,v.name AS venue_name,
  v.address AS venue_address,v.active AS venue_active`
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const invalid = () => new HttpError(400,'ONBOARDING_INVALID','Проверьте данные заведения. Ключи интеграций на этом шаге не принимаются.')
const appInvalid = () => new HttpError(400,'ONBOARDING_APP_INVALID','Проверьте настройки приложения. Ключи, URL и произвольные поля на этом шаге не принимаются.')
const scopeInvalid = () => new HttpError(400,'ONBOARDING_SCOPE_INVALID','Не удалось подтвердить версии черновика и приложения. Ключи интеграций здесь не принимаются.')
const hasControlCharacter=(value:string)=>Array.from(value).some(character=>{
  const code=character.charCodeAt(0)
  return code<=31||code===127
})

function record(raw: unknown, allowed: readonly string[]): Record<string,unknown> {
  if(!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid()
  const value = raw as Record<string,unknown>
  if(Object.keys(value).some(key=>!allowed.includes(key))) throw invalid()
  return value
}
function text(raw: unknown, max: number, required=false): string {
  if(raw !== undefined && typeof raw !== 'string') throw invalid()
  const value = String(raw ?? '').trim()
  if(value.length>max || (required&&!value) || hasControlCharacter(value)) throw invalid()
  return value
}
function uuid(raw: unknown): string {
  if(typeof raw!=='string'||!uuidPattern.test(raw)) throw invalid()
  return raw.toLowerCase()
}
function appText(raw: unknown, max: number, required=false): string {
  if(raw !== undefined && typeof raw !== 'string') throw appInvalid()
  const value=String(raw ?? '').trim()
  if(value.length>max||(required&&!value)||hasControlCharacter(value)) throw appInvalid()
  return value
}
function appBoolean(raw: unknown): boolean {
  if(typeof raw!=='boolean') throw appInvalid()
  return raw
}
export function onboardingAppConfig(raw: unknown): OnboardingAppConfig {
  if(!raw||typeof raw!=='object'||Array.isArray(raw)) throw appInvalid()
  const value=raw as Record<string,unknown>
  if(Object.keys(value).some(key=>!appFields.includes(key as typeof appFields[number]))) throw appInvalid()
  const theme=appText(value.theme,20,true)
  if(!['premium-dark','dark','light'].includes(theme)) throw appInvalid()
  const color=(input:unknown)=>{
    const value=appText(input,7,true).toLowerCase()
    if(!/^#[0-9a-f]{6}$/.test(value)) throw appInvalid()
    return value
  }
  return {
    displayName:appText(value.displayName,120,true),
    theme:theme as OnboardingAppConfig['theme'],
    primaryColor:color(value.primaryColor),
    secondaryColor:color(value.secondaryColor),
    shopEnabled:appBoolean(value.shopEnabled),
    loyaltyEnabled:appBoolean(value.loyaltyEnabled),
  }
}
export function onboardingData(raw: unknown): OnboardingData {
  const value = record(raw,fields)
  let companyId: string | null = null
  if(value.companyId!==null && value.companyId!==undefined && value.companyId!=='') {
    if(typeof value.companyId!=='string'||!/^[1-9]\d{0,18}$/.test(value.companyId)||BigInt(value.companyId)>9223372036854775807n) throw invalid()
    companyId=value.companyId
  }
  const companyName=text(value.companyName,120,!companyId)
  if(companyId && companyName) throw invalid() // never implicitly rename an existing company
  const timeZone=text(value.timeZone,64,true)
  try { new Intl.DateTimeFormat('ru-RU',{timeZone}).format() } catch { throw invalid() }
  const venueType=text(value.venueType,20,true)
  if(!['bar','cafe','restaurant','shop','other'].includes(venueType)) throw invalid()
  const ownerEmail=text(value.ownerEmail,254).toLowerCase()
  if(ownerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) throw invalid()
  return {companyId,companyName,venueName:text(value.venueName,120,true),address:text(value.address,300),
    timeZone,venueType:venueType as OnboardingData['venueType'],ownerEmail}
}
export function requireOnboardingAccess(admin: AdminPrincipal): void {
  requireSuperAdmin(admin)
  if(!config.enableWrites||!config.enableOnboardingDrafts) throw new HttpError(403,'ONBOARDING_DISABLED','Мастер подключения пока выключен.')
}
async function ready(admin: AdminPrincipal): Promise<void> {
  requireOnboardingAccess(admin)
  try {
    const result=await pool.query<{exists:boolean}>("SELECT to_regclass('public.admin_onboarding_drafts') IS NOT NULL AS exists")
    if(!result.rows[0]?.exists) throw new HttpError(503,'ONBOARDING_NOT_READY','Хранилище черновиков ещё не подготовлено.')
  } catch(error) { unavailable(error) }
}
async function appReady(admin: AdminPrincipal): Promise<void> {
  await ready(admin)
  try {
    const result=await pool.query<{exists:boolean}>("SELECT to_regclass('public.admin_onboarding_app_configs') IS NOT NULL AS exists")
    if(!result.rows[0]?.exists) throw new HttpError(503,'ONBOARDING_APP_NOT_READY','Хранилище конфигурации приложения ещё не подготовлено.')
  } catch(error) { unavailable(error) }
}
async function scopeReady(admin: AdminPrincipal): Promise<void> {
  await appReady(admin)
  try {
    const result=await pool.query<{exists:boolean}>("SELECT to_regclass('public.admin_onboarding_scopes') IS NOT NULL AS exists")
    if(!result.rows[0]?.exists) throw new HttpError(503,'ONBOARDING_SCOPE_NOT_READY','Хранилище областей заведений ещё не подготовлено.')
  } catch(error) { unavailable(error) }
}
async function connection(): Promise<PoolClient> {
  try {return await pool.connect()} catch(error) {unavailable(error)}
}
function response(row: DraftRow) {
  return {id:row.id,requestKey:row.request_key,data:row.data,status:row.status,revision:row.revision,updatedAt:row.updated_at}
}
const appContract = {
  template:'standard' as const,
  qrEnabled:true as const,
  isolationPolicy:'dedicated_database' as const,
  legacyDataAccess:false as const,
  runtimeStatus:'not_provisioned' as const,
  published:false as const,
}
function appResponse(row: AppConfigRow) {
  const appConfig=onboardingAppConfig(row.config)
  return {
    draftId:row.draft_id,
    tenantKey:row.tenant_key,
    config:appConfig,
    revision:row.revision,
    updatedAt:row.updated_at,
    contract:{...appContract,isolationPolicy:row.isolation_policy},
    runtimeManifest:createSpaceverseRuntimeManifest({
      draftId:row.draft_id,runtimeKey:row.tenant_key,revision:row.revision,config:appConfig,
    }),
  }
}
const scopeContract = {
  status:'prepared' as const,
  venueActive:false as const,
  runtimeStatus:'not_provisioned' as const,
  staffAccessGranted:false as const,
  providerConnectionsCreated:false as const,
}
function scopeResponse(row: ScopeRow) {
  if(row.status!=='prepared'||row.revision!==1||row.venue_company_id!==row.company_id||row.venue_active||
    (row.company_created_by_onboarding&&row.company_active)) {
    throw new HttpError(503,'ONBOARDING_SCOPE_INCONSISTENT','Подготовленная область не прошла проверку безопасности.')
  }
  return {
    draftId:row.draft_id,
    company:{id:row.company_id,code:row.company_code,createdByOnboarding:row.company_created_by_onboarding,active:row.company_active},
    venue:{id:row.venue_id,code:row.venue_code,active:false as const},
    source:{draftRevision:row.draft_revision,applicationRevision:row.application_revision},
    revision:row.revision,
    updatedAt:row.updated_at,
    contract:scopeContract,
  }
}
function unavailable(error: unknown): never {
  if(error instanceof HttpError) throw error
  // Database errors may contain entire rows. Do not send/log draft contacts or bodies.
  throw new HttpError(503,'ONBOARDING_UNAVAILABLE','Не удалось подтвердить сохранение данных мастера. Повторите сохранение.')
}
async function companyAvailable(client: PoolClient, data: OnboardingData): Promise<void> {
  if(!data.companyId) return
  const result=await client.query('SELECT id FROM companies WHERE id=$1::bigint AND active=TRUE FOR SHARE',[data.companyId])
  if(!result.rowCount) throw new HttpError(404,'ONBOARDING_COMPANY_NOT_FOUND','Организация недоступна. Выберите другую организацию.')
}
async function scopeTableExists(client: PoolClient): Promise<boolean> {
  const result=await client.query<{exists:boolean}>("SELECT to_regclass('public.admin_onboarding_scopes') IS NOT NULL AS exists")
  return Boolean(result.rows[0]?.exists)
}
async function assertScopeNotPrepared(client: PoolClient, draftId: string): Promise<void> {
  if(!await scopeTableExists(client)) return
  const result=await client.query('SELECT 1 FROM admin_onboarding_scopes WHERE draft_id=$1::uuid LIMIT 1',[draftId])
  if(result.rowCount) throw new HttpError(409,'ONBOARDING_SCOPE_LOCKED','Область уже подготовлена. Создайте новый черновик, если нужно изменить организацию, заведение или приложение.')
}
async function loadScope(client: Pick<PoolClient,'query'>, draftId: string): Promise<ScopeRow|undefined> {
  return (await client.query<ScopeRow>(`SELECT ${joinedScopeColumns}
    FROM admin_onboarding_scopes s
    JOIN companies c ON c.id=s.company_id
    JOIN venues v ON v.id=s.venue_id
    WHERE s.draft_id=$1::uuid`,[draftId])).rows[0]
}
export async function getOnboardingIndex(admin: AdminPrincipal) {
  try {
    await ready(admin)
    const drafts=await pool.query<DraftRow>(`SELECT ${columns} FROM admin_onboarding_drafts WHERE admin_id=$1::bigint ORDER BY updated_at DESC,id LIMIT 50`,[admin.id])
    const companies=await pool.query<{id:string;name:string}>('SELECT id::text,name FROM companies WHERE active=TRUE ORDER BY name,id')
    return {drafts:drafts.rows.map(response),companies:companies.rows}
  } catch(error) { unavailable(error) }
}
export async function getOnboardingDraft(admin: AdminPrincipal, id: string) {
  try {
    await ready(admin)
    const result=await pool.query<DraftRow>(`SELECT ${columns} FROM admin_onboarding_drafts WHERE id=$1::uuid AND admin_id=$2::bigint`,[uuid(id),admin.id])
    if(!result.rows[0]) throw new HttpError(404,'ONBOARDING_DRAFT_NOT_FOUND','Черновик не найден или недоступен.')
    return response(result.rows[0])
  } catch(error) { unavailable(error) }
}
export async function getOnboardingRequest(admin: AdminPrincipal, requestKey: string) {
  try {
    await ready(admin)
    const result=await pool.query<DraftRow>(`SELECT ${columns} FROM admin_onboarding_drafts WHERE request_key=$1::uuid AND admin_id=$2::bigint`,[uuid(requestKey),admin.id])
    return {draft:result.rows[0]?response(result.rows[0]):null}
  } catch(error) { unavailable(error) }
}
export async function createOnboardingDraft(admin: AdminPrincipal, raw: unknown) {
  // Gate before parsing input or opening a transaction, including direct callers.
  requireOnboardingAccess(admin)
  const body=record(raw,['requestKey','data']),requestKey=uuid(body.requestKey),data=onboardingData(body.data)
  const initialHash=crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex')
  await ready(admin)
  const client=await connection()
  try {
    await client.query('BEGIN')
    await companyAvailable(client,data)
    const inserted=await client.query<DraftRow>(`INSERT INTO admin_onboarding_drafts(id,admin_id,company_id,request_key,initial_hash,data)
      VALUES($1::uuid,$2::bigint,$3::bigint,$4::uuid,$5,$6::jsonb)
      ON CONFLICT(admin_id,request_key) DO NOTHING RETURNING ${columns}`,
      [crypto.randomUUID(),admin.id,data.companyId,requestKey,initialHash,JSON.stringify(data)])
    let row=inserted.rows[0]
    if(!row) {
      row=(await client.query<DraftRow>(`SELECT ${columns} FROM admin_onboarding_drafts WHERE admin_id=$1::bigint AND request_key=$2::uuid`,[admin.id,requestKey])).rows[0]
      if(!row||row.initial_hash!==initialHash) throw new HttpError(409,'ONBOARDING_REQUEST_CONFLICT','Этот запрос уже использован для другого черновика. Откройте сохранённый черновик.')
    } else {
      await recordAudit({admin,action:'onboarding.draft_create',entityType:'onboarding_draft',entityId:row.id,
        after:{revision:row.revision,status:row.status},metadata:{companyId:data.companyId}},client)
    }
    await client.query('COMMIT')
    return response(row)
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>undefined)
    unavailable(error)
  } finally { client.release() }
}
export async function updateOnboardingDraft(admin: AdminPrincipal, id: string, raw: unknown) {
  requireOnboardingAccess(admin)
  const draftId=uuid(id),body=record(raw,['revision','data']),data=onboardingData(body.data)
  if(typeof body.revision!=='number'||!Number.isSafeInteger(body.revision)||body.revision<1||body.revision>2147483646) throw invalid()
  await ready(admin)
  const client=await connection()
  try {
    await client.query('BEGIN')
    const before=(await client.query<DraftRow>(`SELECT ${columns} FROM admin_onboarding_drafts WHERE id=$1::uuid AND admin_id=$2::bigint FOR UPDATE`,[draftId,admin.id])).rows[0]
    if(!before) throw new HttpError(404,'ONBOARDING_DRAFT_NOT_FOUND','Черновик не найден или недоступен.')
    // An uncertain PUT can safely replay the same command; a stale edit cannot overwrite another one.
    if(before.revision!==body.revision) {
      if(before.revision===body.revision+1 && JSON.stringify(onboardingData(before.data))===JSON.stringify(data)) {
        await client.query('COMMIT');return response(before)
      }
      throw new HttpError(409,'ONBOARDING_REVISION_CONFLICT','Черновик изменился. Откройте последнюю сохранённую версию.')
    }
    await assertScopeNotPrepared(client,draftId)
    await companyAvailable(client,data)
    const row=(await client.query<DraftRow>(`UPDATE admin_onboarding_drafts SET company_id=$3::bigint,data=$4::jsonb,revision=revision+1,updated_at=NOW()
      WHERE id=$1::uuid AND admin_id=$2::bigint RETURNING ${columns}`,[draftId,admin.id,data.companyId,JSON.stringify(data)])).rows[0]!
    await recordAudit({admin,action:'onboarding.draft_update',entityType:'onboarding_draft',entityId:row.id,
      before:{revision:before.revision},after:{revision:row.revision},metadata:{changedFields:fields.filter(key=>before.data[key]!==data[key])}},client)
    await client.query('COMMIT')
    return response(row)
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>undefined)
    unavailable(error)
  } finally { client.release() }
}

export async function getOnboardingAppConfig(admin: AdminPrincipal, id: string) {
  requireOnboardingAccess(admin)
  const draftId=uuid(id)
  await appReady(admin)
  try {
    const result=await pool.query<AppConfigRow&{owned_draft_id:string}>(`SELECT d.id::text AS owned_draft_id,${joinedAppColumns}
      FROM admin_onboarding_drafts d
      LEFT JOIN admin_onboarding_app_configs a ON a.draft_id=d.id
      WHERE d.id=$1::uuid AND d.admin_id=$2::bigint`,[draftId,admin.id])
    const row=result.rows[0]
    if(!row) throw new HttpError(404,'ONBOARDING_DRAFT_NOT_FOUND','Черновик не найден или недоступен.')
    return {application:row.tenant_key?appResponse(row):null,contract:appContract}
  } catch(error) { unavailable(error) }
}

export async function saveOnboardingAppConfig(admin: AdminPrincipal, id: string, raw: unknown) {
  requireOnboardingAccess(admin)
  const draftId=uuid(id)
  if(!raw||typeof raw!=='object'||Array.isArray(raw)) throw appInvalid()
  const body=raw as Record<string,unknown>
  if(Object.keys(body).some(key=>!['revision','config'].includes(key))) throw appInvalid()
  if(typeof body.revision!=='number'||!Number.isSafeInteger(body.revision)||body.revision<0||body.revision>2147483646) throw appInvalid()
  const appConfig=onboardingAppConfig(body.config)
  await appReady(admin)
  const client=await connection()
  try {
    await client.query('BEGIN')
    const draft=(await client.query<AppDraftRow>(`SELECT id::text FROM admin_onboarding_drafts
      WHERE id=$1::uuid AND admin_id=$2::bigint FOR UPDATE`,[draftId,admin.id])).rows[0]
    if(!draft) throw new HttpError(404,'ONBOARDING_DRAFT_NOT_FOUND','Черновик не найден или недоступен.')
    const before=(await client.query<AppConfigRow>(`SELECT ${appColumns} FROM admin_onboarding_app_configs WHERE draft_id=$1::uuid FOR UPDATE`,[draftId])).rows[0]
    const same=before&&JSON.stringify(onboardingAppConfig(before.config))===JSON.stringify(appConfig)
    if(before&&before.revision!==body.revision) {
      if(before.revision===Number(body.revision)+1&&same){await client.query('COMMIT');return appResponse(before)}
      throw new HttpError(409,'ONBOARDING_APP_REVISION_CONFLICT','Настройки приложения изменились. Откройте последнюю сохранённую версию.')
    }
    if(!before&&body.revision!==0) throw new HttpError(409,'ONBOARDING_APP_REVISION_CONFLICT','Настройки приложения ещё не созданы. Откройте последнюю сохранённую версию.')
    await assertScopeNotPrepared(client,draftId)
    let row:AppConfigRow
    if(before) {
      row=(await client.query<AppConfigRow>(`UPDATE admin_onboarding_app_configs
        SET config=$2::jsonb,revision=revision+1,updated_at=NOW()
        WHERE draft_id=$1::uuid RETURNING ${appColumns}`,[draftId,JSON.stringify(appConfig)])).rows[0]!
    } else {
      const tenantKey='sv-'+draftId.replaceAll('-','')
      const collision=await client.query(`SELECT 1 FROM companies WHERE code=$1 LIMIT 1`,[tenantKey])
      if(collision.rowCount) throw new HttpError(409,'ONBOARDING_TENANT_KEY_CONFLICT','Не удалось зарезервировать идентификатор приложения. Создайте новый черновик.')
      row=(await client.query<AppConfigRow>(`INSERT INTO admin_onboarding_app_configs(draft_id,tenant_key,config)
        VALUES($1::uuid,$2,$3::jsonb) RETURNING ${appColumns}`,[draftId,tenantKey,JSON.stringify(appConfig)])).rows[0]!
    }
    await recordAudit({admin,action:before?'onboarding.app_config_update':'onboarding.app_config_create',entityType:'onboarding_app_config',entityId:draftId,
      before:before?{revision:before.revision}:null,after:{revision:row.revision},metadata:{tenantKey:row.tenant_key,changedFields:before?appFields.filter(key=>before.config[key]!==appConfig[key]):appFields}},client)
    await client.query('COMMIT')
    return appResponse(row)
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>undefined)
    unavailable(error)
  } finally {client.release()}
}

export async function getOnboardingScope(admin: AdminPrincipal, id: string) {
  requireOnboardingAccess(admin)
  const draftId=uuid(id)
  await scopeReady(admin)
  try {
    const owned=await pool.query<{id:string}>(`SELECT id::text FROM admin_onboarding_drafts
      WHERE id=$1::uuid AND admin_id=$2::bigint`,[draftId,admin.id])
    if(!owned.rows[0]) throw new HttpError(404,'ONBOARDING_DRAFT_NOT_FOUND','Черновик не найден или недоступен.')
    const row=await loadScope(pool,draftId)
    return {scope:row?scopeResponse(row):null,contract:scopeContract}
  } catch(error) { unavailable(error) }
}

export async function prepareOnboardingScope(admin: AdminPrincipal, id: string, raw: unknown) {
  requireOnboardingAccess(admin)
  const draftId=uuid(id)
  if(!raw||typeof raw!=='object'||Array.isArray(raw)) throw scopeInvalid()
  const body=raw as Record<string,unknown>
  if(Object.keys(body).some(key=>!['draftRevision','applicationRevision'].includes(key))) throw scopeInvalid()
  const revision=(value:unknown)=>{
    if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>2147483647) throw scopeInvalid()
    return value
  }
  const draftRevision=revision(body.draftRevision),applicationRevision=revision(body.applicationRevision)
  await scopeReady(admin)
  const client=await connection()
  try {
    await client.query('BEGIN')
    const draft=(await client.query<DraftRow>(`SELECT ${columns} FROM admin_onboarding_drafts
      WHERE id=$1::uuid AND admin_id=$2::bigint FOR UPDATE`,[draftId,admin.id])).rows[0]
    if(!draft) throw new HttpError(404,'ONBOARDING_DRAFT_NOT_FOUND','Черновик не найден или недоступен.')
    const application=(await client.query<AppConfigRow>(`SELECT ${appColumns} FROM admin_onboarding_app_configs
      WHERE draft_id=$1::uuid FOR UPDATE`,[draftId])).rows[0]
    if(!application) throw new HttpError(409,'ONBOARDING_APP_REQUIRED','Сначала сохраните настройки приложения.')
    const existing=await loadScope(client,draftId)
    if(existing) {
      if(existing.draft_revision===draftRevision&&existing.application_revision===applicationRevision) {
        await client.query('COMMIT');return scopeResponse(existing)
      }
      throw new HttpError(409,'ONBOARDING_SCOPE_LOCKED','Область уже подготовлена для другой версии. Откройте сохранённую область.')
    }
    if(draft.revision!==draftRevision||application.revision!==applicationRevision) {
      throw new HttpError(409,'ONBOARDING_SCOPE_REVISION_CONFLICT','Черновик или приложение изменились. Откройте последние сохранённые версии.')
    }
    const data=onboardingData(draft.data)
    let company:{id:string;code:string;name:string;active:boolean},companyCreated=false
    if(data.companyId) {
      const row=(await client.query<{id:string;code:string;name:string;active:boolean}>(`SELECT id::text,code,name,active FROM companies
        WHERE id=$1::bigint AND active=TRUE FOR SHARE`,[data.companyId])).rows[0]
      if(!row) throw new HttpError(404,'ONBOARDING_COMPANY_NOT_FOUND','Организация недоступна. Выберите другую организацию.')
      company=row
    } else {
      company=(await client.query<{id:string;code:string;name:string;active:boolean}>(`INSERT INTO companies(code,name,active)
        VALUES($1,$2,FALSE) RETURNING id::text,code,name,active`,[application.tenant_key,data.companyName])).rows[0]!
      companyCreated=true
    }
    const venue=(await client.query<{id:string;code:string;name:string;address:string|null;active:boolean}>(`INSERT INTO venues(company_id,code,name,address,active)
      VALUES($1::bigint,$2,$3,$4,FALSE) RETURNING id::text,code,name,address,active`,
      [company.id,application.tenant_key,data.venueName,data.address||null])).rows[0]!
    await client.query(`INSERT INTO admin_onboarding_scopes(
      draft_id,company_id,venue_id,company_created_by_onboarding,draft_revision,application_revision)
      VALUES($1::uuid,$2::bigint,$3::bigint,$4,$5,$6)`,
      [draftId,company.id,venue.id,companyCreated,draftRevision,applicationRevision])
    const row=await loadScope(client,draftId)
    if(!row) throw new Error('Scope insert was not confirmed')
    const auditScope:VenueScope={id:venue.id,companyId:company.id,companyCode:company.code,companyName:company.name,
      code:venue.code,name:venue.name,address:venue.address,legacyBarId:null}
    await recordAudit({admin,scope:auditScope,action:'onboarding.scope_prepare',entityType:'onboarding_scope',entityId:draftId,
      after:{status:'prepared',revision:1},metadata:{companyCreated,draftRevision,applicationRevision}},client)
    await client.query('COMMIT')
    return scopeResponse(row)
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>undefined)
    if((error as {code?:string})?.code==='23505') throw new HttpError(409,'ONBOARDING_SCOPE_CONFLICT','Идентификатор области уже занят. Создайте новый черновик.')
    unavailable(error)
  } finally {client.release()}
}
