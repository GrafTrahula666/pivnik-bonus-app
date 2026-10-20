import crypto from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { PoolClient, QueryResultRow } from 'pg'
import { recordAudit } from './audit.js'
import { config } from './config.js'
import { pool } from './db.js'
import { csrfTokenFor, enforceRateLimit, hashIp, hashPassword, normalizeEmail, randomToken, requestIp, setSessionCookie, sha256 } from './security.js'
import { requireSuperAdmin } from './tenant.js'
import { lockOnboardingDraftAccess,onboardingDraftAccessSql,onboardingDraftPermissions,requireOnboardingCompany,requireWritableOnboarding } from './onboarding-access.js'
import { HttpError, type AdminPrincipal, type VenueScope } from './types.js'
import { createSpaceverseRuntimeManifest } from '../../spaceverse-runtime-manifest.js'
import { fetchEvotorPage } from '../../pos/evotor-client.js'
import { onboardingSecretBox, type OnboardingSecretEnvelope } from './onboarding-secrets.js'

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
interface InviteRow extends QueryResultRow {
  id: string
  draft_id: string
  status: 'pending' | 'revoked' | 'claimed'
  expires_at: string
  created_at: string
  revoked_at: string | null
  claimed_at: string | null
}
interface ScopeRow extends QueryResultRow {
  draft_id: string
  tenant_key: string
  application_config: OnboardingAppConfig
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
type IntegrationStatus='configured'|'verified'|'action_required'|'error'
interface IntegrationRow extends QueryResultRow {
  draft_id:string
  provider:'evotor'
  store_id:string
  secret_key_id:string
  secret_nonce:Buffer|Uint8Array
  secret_ciphertext:Buffer|Uint8Array
  secret_auth_tag:Buffer|Uint8Array
  last_request_key:string
  last_request_hash:string
  status:IntegrationStatus
  last_error_code:string|null
  last_checked_at:string|null
  verified_at:string|null
  revision:number
  updated_at:string
}
const fields = ['companyId','companyName','venueName','address','timeZone','venueType','ownerEmail'] as const
const columns = 'id::text,request_key::text,initial_hash,data,status,revision,updated_at::text'
const appFields = ['displayName','theme','primaryColor','secondaryColor','shopEnabled','loyaltyEnabled'] as const
const appColumns = `draft_id::text,tenant_key,config,isolation_policy,provisioning_status,revision,updated_at::text`
const joinedAppColumns = `a.draft_id::text,a.tenant_key,a.config,a.isolation_policy,a.provisioning_status,a.revision,a.updated_at::text`
const joinedScopeColumns = `s.draft_id::text,s.company_id::text,s.venue_id::text,s.company_created_by_onboarding,
  s.draft_revision,s.application_revision,s.status,s.revision,s.updated_at::text,
  a.tenant_key,a.config AS application_config,
  c.code AS company_code,c.name AS company_name,c.active AS company_active,
  v.company_id::text AS venue_company_id,v.code AS venue_code,v.name AS venue_name,
  v.address AS venue_address,v.active AS venue_active`
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const invalid = () => new HttpError(400,'ONBOARDING_INVALID','Проверьте данные заведения. Ключи интеграций на этом шаге не принимаются.')
const appInvalid = () => new HttpError(400,'ONBOARDING_APP_INVALID','Проверьте настройки приложения. Ключи, URL и произвольные поля на этом шаге не принимаются.')
const scopeInvalid = () => new HttpError(400,'ONBOARDING_SCOPE_INVALID','Не удалось подтвердить версии черновика и приложения. Ключи интеграций здесь не принимаются.')
const integrationInvalid=()=>new HttpError(400,'ONBOARDING_INTEGRATION_INVALID','Проверьте ID магазина, токен и версию настройки Эвотора.')
const INVITE_TTL = '7 days'
const inviteColumns = 'id::text,draft_id::text,status,expires_at::text,created_at::text,revoked_at::text,claimed_at::text'
const integrationColumns=`draft_id::text,provider,store_id,secret_key_id,secret_nonce,secret_ciphertext,secret_auth_tag,
  last_request_key::text,last_request_hash,status,last_error_code,last_checked_at::text,verified_at::text,revision,updated_at::text`
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
export async function requireOnboardingAccess(admin: AdminPrincipal,write=false,db:Pick<PoolClient,'query'>=pool): Promise<void> {
  if(!config.enableWrites||!config.enableOnboardingDrafts) throw new HttpError(403,'ONBOARDING_DISABLED','Мастер подключения пока выключен.')
  if(!config.enableOnboardingInvitations){requireSuperAdmin(admin);return}
  await requireWritableOnboarding(admin,write,db)
}
export async function requireOnboardingIntegrationAccess(admin:AdminPrincipal,write=false):Promise<void> {
  await requireOnboardingAccess(admin,write)
  if(!config.enableOnboardingIntegrations)throw new HttpError(403,'ONBOARDING_INTEGRATIONS_DISABLED','Защищённые подключения мастера пока выключены.')
}
async function ready(admin: AdminPrincipal): Promise<void> {
  await requireOnboardingAccess(admin)
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
async function integrationReady(admin:AdminPrincipal):Promise<void> {
  await requireOnboardingIntegrationAccess(admin)
  await scopeReady(admin)
  onboardingSecretBox()
  try {
    const result=await pool.query<{exists:boolean}>("SELECT to_regclass('public.admin_onboarding_integrations') IS NOT NULL AS exists")
    if(!result.rows[0]?.exists)throw new HttpError(503,'ONBOARDING_INTEGRATION_NOT_READY','Хранилище защищённых подключений ещё не подготовлено.')
  } catch(error) {unavailable(error)}
}
async function inviteReady(admin: AdminPrincipal): Promise<void> {
  await scopeReady(admin)
  try {
    const result=await pool.query<{exists:boolean}>("SELECT to_regclass('public.admin_onboarding_invites') IS NOT NULL AS exists")
    if(!result.rows[0]?.exists) throw new HttpError(503,'ONBOARDING_INVITE_NOT_READY','Хранилище приглашений ещё не подготовлено.')
  } catch(error) { unavailable(error) }
}
function inviteResponse(row: InviteRow) {
  return {id:row.id,draftId:row.draft_id,status:row.status,expiresAt:row.expires_at,createdAt:row.created_at,revokedAt:row.revoked_at,claimedAt:row.claimed_at}
}
async function connection(): Promise<PoolClient> {
  try {return await pool.connect()} catch(error) {unavailable(error)}
}
function response(row: DraftRow) {
  return {id:row.id,requestKey:row.request_key,data:row.data,status:row.status,revision:row.revision,updatedAt:row.updated_at}
}
async function permittedResponse(admin:AdminPrincipal,row:DraftRow){
  return config.enableOnboardingInvitations?{...response(row),permissions:await onboardingDraftPermissions(admin,row.id)}:response(row)
}
const appContract = {
  template:'standard' as const,
  qrEnabled:true as const,
  isolationPolicy:'dedicated_database' as const,
  legacyDataAccess:false as const,
  runtimeStatus:'not_provisioned' as const,
  published:false as const,
}
function scopeIsConsistent(row: ScopeRow): boolean {
  return row.status==='prepared'&&row.revision===1&&row.venue_company_id===row.company_id&&!row.venue_active&&
    !(row.company_created_by_onboarding&&row.company_active)
}
function runtimeManifest(row: Pick<AppConfigRow,'draft_id'|'tenant_key'|'config'|'revision'>, scope: ScopeRow) {
  if(!scopeIsConsistent(scope)||scope.draft_id!==row.draft_id||scope.application_revision!==row.revision) {
    throw new HttpError(503,'ONBOARDING_SCOPE_INCONSISTENT','Подготовленная область не прошла проверку безопасности.')
  }
  return createSpaceverseRuntimeManifest({
    draftId:row.draft_id,runtimeKey:row.tenant_key,draftRevision:scope.draft_revision,
    applicationRevision:row.revision,scopeRevision:1,
    scope:{companyId:scope.company_id,venueId:scope.venue_id},config:onboardingAppConfig(row.config),
  })
}
function appResponse(row: AppConfigRow, scope?: ScopeRow) {
  const appConfig=onboardingAppConfig(row.config)
  return {
    draftId:row.draft_id,
    tenantKey:row.tenant_key,
    config:appConfig,
    revision:row.revision,
    updatedAt:row.updated_at,
    contract:{...appContract,isolationPolicy:row.isolation_policy},
    runtimeManifest:scope?runtimeManifest(row,scope):null,
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
  if(!scopeIsConsistent(row)) {
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
    runtimeManifest:runtimeManifest({draft_id:row.draft_id,tenant_key:row.tenant_key,
      config:row.application_config,revision:row.application_revision},row),
  }
}
const integrationContract={
  provider:'evotor' as const,
  credentialStorage:'server_encrypted' as const,
  credentialExposure:'masked_only' as const,
  verificationMethod:'documents_read' as const,
  externalAccountCreated:false as const,
  posBindingCreated:false as const,
  runtimeStatus:'not_provisioned' as const,
}
export const providerAdvice:Record<string,string>={
  not_verified:'Нажмите «Проверить доступ», чтобы подтвердить токен и права на магазин.',
  token_expired:'Обновите токен Эвотора и сохраните настройку повторно.',
  forbidden:'Проверьте права токена на документы указанного магазина.',
  not_installed:'Установите приложение интеграции для этого магазина в Эвоторе.',
  rate_limit:'Эвотор ограничил частоту запросов. Повторите проверку позже.',
  network:'Облако Эвотора не ответило вовремя. Повторите проверку позже.',
  invalid_response:'Эвотор вернул неожиданный ответ. Повторите позже или обратитесь в поддержку.',
  invalid_cursor:'Эвотор отклонил запрос проверки. Сохраните настройку заново.',
  api_error:'Эвотор отклонил запрос. Повторите позже или обратитесь в поддержку.',
  documents_readable:'Токен и чтение документов магазина подтверждены. Привязка POS и публикация приложения ещё не выполнены.',
}
function integrationAad(draftId:string,storeId:string):string {
  return `spaceverse:onboarding:${draftId}:evotor:${storeId}`
}
function integrationEnvelope(row:IntegrationRow):OnboardingSecretEnvelope {
  return {keyId:row.secret_key_id,nonce:row.secret_nonce,ciphertext:row.secret_ciphertext,authTag:row.secret_auth_tag}
}
function storedIntegrationSecret(row:IntegrationRow):string {
  const token=onboardingSecretBox().decrypt(integrationEnvelope(row),integrationAad(row.draft_id,row.store_id))
  if(token.length<16||token.length>4096||/\s/.test(token)||hasControlCharacter(token)) {
    throw new HttpError(503,'ONBOARDING_SECRET_KEY_UNAVAILABLE','Защищённая настройка Эвотора повреждена или недоступна.')
  }
  return token
}
function integrationResponse(row:IntegrationRow) {
  const code=row.status==='configured'?'not_verified':row.status==='verified'?'documents_readable':row.last_error_code||'api_error'
  return {
    draftId:row.draft_id,provider:row.provider,storeId:row.store_id,
    credential:{present:true as const,masked:'••••••••' as const},
    status:row.status,verification:{code,checkedAt:row.last_checked_at,verifiedAt:row.verified_at,nextAction:providerAdvice[code]||providerAdvice.api_error},
    revision:row.revision,updatedAt:row.updated_at,contract:integrationContract,
  }
}
function integrationCommand(raw:unknown) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw integrationInvalid()
  const body=raw as Record<string,unknown>
  if(Object.keys(body).some(key=>!['requestKey','revision','storeId','token'].includes(key)))throw integrationInvalid()
  if(typeof body.requestKey!=='string'||!uuidPattern.test(body.requestKey))throw integrationInvalid()
  if(typeof body.revision!=='number'||!Number.isSafeInteger(body.revision)||body.revision<0||body.revision>2147483646)throw integrationInvalid()
  if(typeof body.storeId!=='string'||!body.storeId||body.storeId!==body.storeId.trim()||body.storeId.length>200||hasControlCharacter(body.storeId))throw integrationInvalid()
  if(typeof body.token!=='string'||body.token.length<16||body.token.length>4096||body.token!==body.token.trim()||/\s/.test(body.token)||hasControlCharacter(body.token))throw integrationInvalid()
  return {requestKey:body.requestKey.toLowerCase(),revision:body.revision,storeId:body.storeId,token:body.token}
}
function integrationVerificationCommand(raw:unknown) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw integrationInvalid()
  const body=raw as Record<string,unknown>
  if(Object.keys(body).some(key=>key!=='revision')||typeof body.revision!=='number'||!Number.isSafeInteger(body.revision)||body.revision<1||body.revision>2147483646)throw integrationInvalid()
  return {revision:body.revision}
}
function integrationCanonicalCommand(storeId:string,token:string):string {
  return JSON.stringify({provider:'evotor',storeId,token})
}
function integrationAuditScope(row:ScopeRow):VenueScope {
  return {id:row.venue_id,companyId:row.company_id,companyCode:row.company_code,companyName:row.company_name,
    code:row.venue_code,name:row.venue_name,address:row.venue_address,legacyBarId:null}
}
function unavailable(error: unknown): never {
  if(error instanceof HttpError) throw error
  // Database errors may contain entire rows. Do not send/log draft contacts or bodies.
  throw new HttpError(503,'ONBOARDING_UNAVAILABLE','Не удалось подтвердить сохранение данных мастера. Повторите сохранение.')
}
async function companyAvailable(client: PoolClient, data: OnboardingData,admin:AdminPrincipal): Promise<void> {
  if(config.enableOnboardingInvitations)await requireOnboardingCompany(client,admin,data.companyId)
  if(!data.companyId) return
  const result=config.enableOnboardingInvitations
    ?await client.query(`SELECT id FROM companies WHERE id=$1::bigint AND (active=TRUE OR EXISTS(
      SELECT 1 FROM admin_onboarding_scopes scope JOIN admin_onboarding_drafts draft ON draft.id=scope.draft_id
      WHERE scope.company_id=companies.id AND (draft.admin_id=$2::bigint
        OR EXISTS(SELECT 1 FROM admin_company_access WHERE admin_id=$2::bigint AND company_id=companies.id AND access_kind='owner')
        OR EXISTS(SELECT 1 FROM admin_onboarding_access WHERE admin_id=$2::bigint AND company_id=companies.id
          AND venue_id IS NULL AND role IN ('owner','manager') AND revoked_at IS NULL)))) FOR SHARE`,[data.companyId,admin.id])
    :await client.query('SELECT id FROM companies WHERE id=$1::bigint AND active=TRUE FOR SHARE',[data.companyId])
  if(!result.rowCount) throw new HttpError(404,'ONBOARDING_COMPANY_NOT_FOUND','Организация недоступна. Выберите другую организацию.')
}
async function scopeTableExists(client: Pick<PoolClient,'query'>): Promise<boolean> {
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
    JOIN admin_onboarding_app_configs a ON a.draft_id=s.draft_id
    JOIN companies c ON c.id=s.company_id
    JOIN venues v ON v.id=s.venue_id
    WHERE s.draft_id=$1::uuid`,[draftId])).rows[0]
}
async function loadOptionalScope(client: Pick<PoolClient,'query'>, draftId: string): Promise<ScopeRow|undefined> {
  return await scopeTableExists(client)?loadScope(client,draftId):undefined
}
export async function getOnboardingIndex(admin: AdminPrincipal) {
  try {
    await ready(admin)
    const drafts=await pool.query<DraftRow>(`SELECT ${columns} FROM admin_onboarding_drafts WHERE ${onboardingDraftAccessSql('admin_onboarding_drafts','$1')} ORDER BY updated_at DESC,id LIMIT 50`,[admin.id])
    const companies=admin.role==='SUPER_ADMIN'
      ?await pool.query<{id:string;name:string}>('SELECT id::text,name FROM companies WHERE active=TRUE ORDER BY name,id')
      :await pool.query<{id:string;name:string}>(`SELECT company.id::text,company.name FROM companies company WHERE
        EXISTS(SELECT 1 FROM admin_company_access WHERE admin_id=$1::bigint AND company_id=company.id AND access_kind='owner')
        OR EXISTS(SELECT 1 FROM admin_onboarding_access WHERE admin_id=$1::bigint AND company_id=company.id AND revoked_at IS NULL)
        ORDER BY company.name,company.id`,[admin.id])
    return {drafts:await Promise.all(drafts.rows.map(row=>permittedResponse(admin,row))),companies:companies.rows}
  } catch(error) { unavailable(error) }
}
export async function getOnboardingDraft(admin: AdminPrincipal, id: string) {
  try {
    await ready(admin)
    const result=await pool.query<DraftRow>(`SELECT ${columns} FROM admin_onboarding_drafts WHERE id=$1::uuid AND ${onboardingDraftAccessSql()}`,[uuid(id),admin.id])
    if(!result.rows[0]) throw new HttpError(404,'ONBOARDING_DRAFT_NOT_FOUND','Черновик не найден или недоступен.')
    return permittedResponse(admin,result.rows[0])
  } catch(error) { unavailable(error) }
}
export async function getOnboardingRequest(admin: AdminPrincipal, requestKey: string) {
  try {
    await ready(admin)
    const result=await pool.query<DraftRow>(`SELECT ${columns} FROM admin_onboarding_drafts WHERE request_key=$1::uuid AND ${onboardingDraftAccessSql()}`,[uuid(requestKey),admin.id])
    return {draft:result.rows[0]?await permittedResponse(admin,result.rows[0]):null}
  } catch(error) { unavailable(error) }
}
export async function createOnboardingDraft(admin: AdminPrincipal, raw: unknown) {
  // Gate before parsing input or opening a transaction, including direct callers.
  await requireOnboardingAccess(admin,true)
  const body=record(raw,['requestKey','data']),requestKey=uuid(body.requestKey),data=onboardingData(body.data)
  const initialHash=crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex')
  await ready(admin)
  const client=await connection()
  try {
    await client.query('BEGIN')
    await companyAvailable(client,data,admin)
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
    return permittedResponse(admin,row)
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>undefined)
    unavailable(error)
  } finally { client.release() }
}
export async function updateOnboardingDraft(admin: AdminPrincipal, id: string, raw: unknown) {
  await requireOnboardingAccess(admin,true)
  const draftId=uuid(id),body=record(raw,['revision','data']),data=onboardingData(body.data)
  if(typeof body.revision!=='number'||!Number.isSafeInteger(body.revision)||body.revision<1||body.revision>2147483646) throw invalid()
  await ready(admin)
  const client=await connection()
  try {
    await client.query('BEGIN')
    await lockOnboardingDraftAccess(client,admin,draftId)
    const before=(await client.query<DraftRow>(`SELECT ${columns} FROM admin_onboarding_drafts WHERE id=$1::uuid AND ${onboardingDraftAccessSql("admin_onboarding_drafts","$2",true)} FOR UPDATE`,[draftId,admin.id])).rows[0]
    if(!before) throw new HttpError(404,'ONBOARDING_DRAFT_NOT_FOUND','Черновик не найден или недоступен.')
    // An uncertain PUT can safely replay the same command; a stale edit cannot overwrite another one.
    if(before.revision!==body.revision) {
      if(before.revision===body.revision+1 && JSON.stringify(onboardingData(before.data))===JSON.stringify(data)) {
        await client.query('COMMIT');return permittedResponse(admin,before)
      }
      throw new HttpError(409,'ONBOARDING_REVISION_CONFLICT','Черновик изменился. Откройте последнюю сохранённую версию.')
    }
    await assertScopeNotPrepared(client,draftId)
    await companyAvailable(client,data,admin)
    const row=(await client.query<DraftRow>(`UPDATE admin_onboarding_drafts SET company_id=$3::bigint,data=$4::jsonb,revision=revision+1,updated_at=NOW()
      WHERE id=$1::uuid AND ${onboardingDraftAccessSql("admin_onboarding_drafts","$2",true)} RETURNING ${columns}`,[draftId,admin.id,data.companyId,JSON.stringify(data)])).rows[0]!
    await recordAudit({admin,action:'onboarding.draft_update',entityType:'onboarding_draft',entityId:row.id,
      before:{revision:before.revision},after:{revision:row.revision},metadata:{changedFields:fields.filter(key=>before.data[key]!==data[key])}},client)
    await client.query('COMMIT')
    return permittedResponse(admin,row)
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>undefined)
    unavailable(error)
  } finally { client.release() }
}

export async function getOnboardingAppConfig(admin: AdminPrincipal, id: string) {
  await requireOnboardingAccess(admin)
  const draftId=uuid(id)
  await appReady(admin)
  try {
    const result=await pool.query<AppConfigRow&{owned_draft_id:string}>(`SELECT d.id::text AS owned_draft_id,${joinedAppColumns}
      FROM admin_onboarding_drafts d
      LEFT JOIN admin_onboarding_app_configs a ON a.draft_id=d.id
      WHERE d.id=$1::uuid AND ${onboardingDraftAccessSql("d")}`,[draftId,admin.id])
    const row=result.rows[0]
    if(!row) throw new HttpError(404,'ONBOARDING_DRAFT_NOT_FOUND','Черновик не найден или недоступен.')
    const scope=row.tenant_key?await loadOptionalScope(pool,draftId):undefined
    return {application:row.tenant_key?appResponse(row,scope):null,contract:appContract}
  } catch(error) { unavailable(error) }
}

export async function saveOnboardingAppConfig(admin: AdminPrincipal, id: string, raw: unknown) {
  await requireOnboardingAccess(admin,true)
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
    await lockOnboardingDraftAccess(client,admin,draftId)
    const draft=(await client.query<AppDraftRow>(`SELECT id::text FROM admin_onboarding_drafts
      WHERE id=$1::uuid AND ${onboardingDraftAccessSql("admin_onboarding_drafts","$2",true)} FOR UPDATE`,[draftId,admin.id])).rows[0]
    if(!draft) throw new HttpError(404,'ONBOARDING_DRAFT_NOT_FOUND','Черновик не найден или недоступен.')
    const before=(await client.query<AppConfigRow>(`SELECT ${appColumns} FROM admin_onboarding_app_configs WHERE draft_id=$1::uuid FOR UPDATE`,[draftId])).rows[0]
    const same=before&&JSON.stringify(onboardingAppConfig(before.config))===JSON.stringify(appConfig)
    if(before&&before.revision!==body.revision) {
      if(before.revision===Number(body.revision)+1&&same){
        const scope=await loadOptionalScope(client,draftId)
        await client.query('COMMIT');return appResponse(before,scope)
      }
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
  await requireOnboardingAccess(admin)
  const draftId=uuid(id)
  await scopeReady(admin)
  try {
    const owned=await pool.query<{id:string}>(`SELECT id::text FROM admin_onboarding_drafts
      WHERE id=$1::uuid AND ${onboardingDraftAccessSql()}`,[draftId,admin.id])
    if(!owned.rows[0]) throw new HttpError(404,'ONBOARDING_DRAFT_NOT_FOUND','Черновик не найден или недоступен.')
    const row=await loadScope(pool,draftId)
    return {scope:row?scopeResponse(row):null,contract:scopeContract}
  } catch(error) { unavailable(error) }
}

export async function prepareOnboardingScope(admin: AdminPrincipal, id: string, raw: unknown) {
  await requireOnboardingAccess(admin,true)
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
    await lockOnboardingDraftAccess(client,admin,draftId)
    const draft=(await client.query<DraftRow>(`SELECT ${columns} FROM admin_onboarding_drafts
      WHERE id=$1::uuid AND ${onboardingDraftAccessSql("admin_onboarding_drafts","$2",true)} FOR UPDATE`,[draftId,admin.id])).rows[0]
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
      await companyAvailable(client,data,admin)
      const row=(await client.query<{id:string;code:string;name:string;active:boolean}>(`SELECT id::text,code,name,active FROM companies
        WHERE id=$1::bigint FOR SHARE`,[data.companyId])).rows[0]
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

async function ownedDraftWithPreparedScope(client: Pick<PoolClient,'query'>, admin: AdminPrincipal, draftId: string, lock=false): Promise<ScopeRow> {
  if(lock)await lockOnboardingDraftAccess(client,admin,draftId)
  const owned=await client.query<{id:string}>(`SELECT id::text FROM admin_onboarding_drafts
    WHERE id=$1::uuid AND ${onboardingDraftAccessSql('admin_onboarding_drafts','$2',lock)}${lock?' FOR UPDATE':''}`,[draftId,admin.id])
  if(!owned.rows[0]) throw new HttpError(404,'ONBOARDING_DRAFT_NOT_FOUND','Черновик не найден или недоступен.')
  const scope=await loadScope(client,draftId)
  if(!scope||!scopeIsConsistent(scope)) throw new HttpError(409,'ONBOARDING_SCOPE_REQUIRED','Сначала подготовьте область заведения.')
  return scope
}

// Server-only source for provisioning. The target database is deliberately not
// accepted here: callers receive the exact manifest derived from the frozen
// draft/application/scope and must resolve credentials outside request data.
export async function loadOwnedOnboardingRuntimeSource(
  client: Pick<PoolClient,'query'>,
  admin: AdminPrincipal,
  id: string,
  lock=false,
) {
  await requireOnboardingAccess(admin,lock,client)
  const draftId=uuid(id)
  const scope=await ownedDraftWithPreparedScope(client,admin,draftId,lock)
  const manifest=runtimeManifest({
    draft_id:scope.draft_id,
    tenant_key:scope.tenant_key,
    config:scope.application_config,
    revision:scope.application_revision,
  },scope)
  return {draftId,manifest,auditScope:integrationAuditScope(scope)}
}

export async function getOnboardingEvotorIntegration(admin:AdminPrincipal,id:string) {
  await requireOnboardingIntegrationAccess(admin)
  const draftId=uuid(id)
  await integrationReady(admin)
  try {
    await ownedDraftWithPreparedScope(pool,admin,draftId)
    const row=(await pool.query<IntegrationRow>(`SELECT ${integrationColumns} FROM admin_onboarding_integrations
      WHERE draft_id=$1::uuid AND provider='evotor'`,[draftId])).rows[0]
    // A masked record is useful only when the key material and authenticated binding are readable.
    if(row) storedIntegrationSecret(row)
    return {integration:row?integrationResponse(row):null,contract:integrationContract}
  } catch(error) {unavailable(error)}
}

export async function saveOnboardingEvotorIntegration(admin:AdminPrincipal,id:string,raw:unknown) {
  await requireOnboardingIntegrationAccess(admin,true)
  const draftId=uuid(id),command=integrationCommand(raw)
  await integrationReady(admin)
  const secretBox=onboardingSecretBox()
  const client=await connection()
  try {
    await client.query('BEGIN')
    const scope=await ownedDraftWithPreparedScope(client,admin,draftId,true)
    const before=(await client.query<IntegrationRow>(`SELECT ${integrationColumns} FROM admin_onboarding_integrations
      WHERE draft_id=$1::uuid AND provider='evotor' FOR UPDATE`,[draftId])).rows[0]
    const canonical=integrationCanonicalCommand(command.storeId,command.token)
    if(before?.last_request_key===command.requestKey) {
      const sameHash=secretBox.matchesFingerprint(before.last_request_hash,secretBox.fingerprint(before.secret_key_id,canonical))
      const sameSecret=storedIntegrationSecret(before)===command.token&&before.store_id===command.storeId
      if(!sameHash||!sameSecret) throw new HttpError(409,'ONBOARDING_INTEGRATION_REQUEST_CONFLICT','Этот ключ запроса уже использован с другими данными.')
      await client.query('COMMIT')
      return integrationResponse(before)
    }
    if(before&&before.revision!==command.revision) throw new HttpError(409,'ONBOARDING_INTEGRATION_REVISION_CONFLICT','Настройка Эвотора изменилась. Откройте последнюю сохранённую версию.')
    if(!before&&command.revision!==0) throw new HttpError(409,'ONBOARDING_INTEGRATION_REVISION_CONFLICT','Настройка Эвотора ещё не создана. Откройте последнюю сохранённую версию.')
    const encrypted=secretBox.encrypt(command.token,integrationAad(draftId,command.storeId))
    const fingerprint=secretBox.fingerprint(encrypted.keyId,canonical)
    let row:IntegrationRow
    if(before) {
      row=(await client.query<IntegrationRow>(`UPDATE admin_onboarding_integrations SET
        store_id=$3,secret_key_id=$4,secret_nonce=$5,secret_ciphertext=$6,secret_auth_tag=$7,
        last_request_key=$8::uuid,last_request_hash=$9,status='configured',last_error_code=NULL,
        last_checked_at=NULL,verified_at=NULL,revision=revision+1,updated_at=NOW()
        WHERE draft_id=$1::uuid AND provider=$2 RETURNING ${integrationColumns}`,
      [draftId,'evotor',command.storeId,encrypted.keyId,encrypted.nonce,encrypted.ciphertext,encrypted.authTag,command.requestKey,fingerprint])).rows[0]!
    } else {
      row=(await client.query<IntegrationRow>(`INSERT INTO admin_onboarding_integrations(
        draft_id,provider,store_id,secret_key_id,secret_nonce,secret_ciphertext,secret_auth_tag,last_request_key,last_request_hash)
        VALUES($1::uuid,$2,$3,$4,$5,$6,$7,$8::uuid,$9) RETURNING ${integrationColumns}`,
      [draftId,'evotor',command.storeId,encrypted.keyId,encrypted.nonce,encrypted.ciphertext,encrypted.authTag,command.requestKey,fingerprint])).rows[0]!
    }
    await recordAudit({admin,scope:integrationAuditScope(scope),action:before?'onboarding.integration_update':'onboarding.integration_create',
      entityType:'onboarding_integration',entityId:draftId,before:before?{provider:'evotor',status:before.status,revision:before.revision}:null,
      after:{provider:'evotor',status:row.status,revision:row.revision},
      metadata:{credentialRotated:Boolean(before),storeChanged:Boolean(before&&before.store_id!==command.storeId)}},client)
    await client.query('COMMIT')
    return integrationResponse(row)
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>undefined)
    unavailable(error)
  } finally {client.release()}
}

const actionRequiredEvotorCodes=new Set(['token_expired','forbidden','not_installed','invalid_cursor'])
const knownEvotorCodes=new Set([...actionRequiredEvotorCodes,'rate_limit','network','invalid_response','api_error'])
export async function verifyOnboardingEvotorIntegration(admin:AdminPrincipal,id:string,raw:unknown) {
  await requireOnboardingIntegrationAccess(admin,true)
  const draftId=uuid(id),command=integrationVerificationCommand(raw)
  await integrationReady(admin)
  let before:IntegrationRow
  try {
    await ownedDraftWithPreparedScope(pool,admin,draftId)
    before=(await pool.query<IntegrationRow>(`SELECT ${integrationColumns} FROM admin_onboarding_integrations
      WHERE draft_id=$1::uuid AND provider='evotor'`,[draftId])).rows[0]!
    if(!before) throw new HttpError(409,'ONBOARDING_INTEGRATION_REQUIRED','Сначала сохраните настройку Эвотора.')
    if(before.revision!==command.revision) throw new HttpError(409,'ONBOARDING_INTEGRATION_REVISION_CONFLICT','Настройка Эвотора изменилась. Откройте последнюю сохранённую версию.')
  } catch(error) {unavailable(error)}
  const token=storedIntegrationSecret(before)
  let status:IntegrationStatus='verified',errorCode:string|null=null
  try {
    await fetchEvotorPage({token,storeId:before.store_id,cursor:null,until:new Date().toISOString()})
  } catch(error) {
    const candidate=(error as {code?:unknown})?.code
    errorCode=typeof candidate==='string'&&knownEvotorCodes.has(candidate)?candidate:'api_error'
    status=actionRequiredEvotorCodes.has(errorCode)?'action_required':'error'
  }
  const secretBox=onboardingSecretBox()
  const client=await connection()
  try {
    await client.query('BEGIN')
    const scope=await ownedDraftWithPreparedScope(client,admin,draftId,true)
    const current=(await client.query<IntegrationRow>(`SELECT ${integrationColumns} FROM admin_onboarding_integrations
      WHERE draft_id=$1::uuid AND provider='evotor' FOR UPDATE`,[draftId])).rows[0]
    if(!current) throw new HttpError(409,'ONBOARDING_INTEGRATION_REQUIRED','Сначала сохраните настройку Эвотора.')
    if(current.revision!==command.revision) throw new HttpError(409,'ONBOARDING_INTEGRATION_REVISION_CONFLICT','Настройка Эвотора изменилась во время проверки. Повторите её для последней версии.')
    const currentToken=storedIntegrationSecret(current)
    if(currentToken!==token||current.store_id!==before.store_id) throw new HttpError(409,'ONBOARDING_INTEGRATION_REVISION_CONFLICT','Настройка Эвотора изменилась во время проверки. Повторите её для последней версии.')
    // Every successful database write rewraps under the active key. Old keys may then be retired safely.
    const encrypted=secretBox.encrypt(currentToken,integrationAad(draftId,current.store_id))
    const fingerprint=secretBox.fingerprint(encrypted.keyId,integrationCanonicalCommand(current.store_id,currentToken))
    const row=(await client.query<IntegrationRow>(`UPDATE admin_onboarding_integrations SET
      secret_key_id=$3,secret_nonce=$4,secret_ciphertext=$5,secret_auth_tag=$6,last_request_hash=$7,
      status=$8,last_error_code=$9,last_checked_at=NOW(),verified_at=CASE WHEN $8='verified' THEN NOW() ELSE verified_at END,
      revision=revision+1,updated_at=NOW()
      WHERE draft_id=$1::uuid AND provider=$2 RETURNING ${integrationColumns}`,
    [draftId,'evotor',encrypted.keyId,encrypted.nonce,encrypted.ciphertext,encrypted.authTag,fingerprint,status,errorCode])).rows[0]!
    await recordAudit({admin,scope:integrationAuditScope(scope),action:'onboarding.integration_verify',entityType:'onboarding_integration',entityId:draftId,
      before:{provider:'evotor',status:current.status,revision:current.revision},after:{provider:'evotor',status:row.status,revision:row.revision},
      metadata:{verificationCode:errorCode||'documents_readable'}},client)
    await client.query('COMMIT')
    return integrationResponse(row)
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>undefined)
    unavailable(error)
  } finally {client.release()}
}

export async function getOnboardingInvites(admin: AdminPrincipal, id: string) {
  requireInviteFeatureEnabled()
  requireSuperAdmin(admin)
  await requireOnboardingAccess(admin)
  const draftId=uuid(id)
  await inviteReady(admin)
  try {
    await ownedDraftWithPreparedScope(pool,admin,draftId)
    const result=await pool.query<InviteRow>(`SELECT ${inviteColumns} FROM admin_onboarding_invites
      WHERE draft_id=$1::uuid ORDER BY created_at DESC LIMIT 20`,[draftId])
    return {invites:result.rows.map(inviteResponse)}
  } catch(error) { unavailable(error) }
}

// The raw token is returned only here, in this one response, and is never stored or logged.
export async function createOnboardingInvite(admin: AdminPrincipal, id: string) {
  requireInviteFeatureEnabled()
  requireSuperAdmin(admin)
  await requireOnboardingAccess(admin)
  const draftId=uuid(id)
  await inviteReady(admin)
  const client=await connection()
  try {
    await client.query('BEGIN')
    await ownedDraftWithPreparedScope(client,admin,draftId)
    const revoked=await client.query<{id:string}>(`UPDATE admin_onboarding_invites SET status='revoked',revoked_at=NOW()
      WHERE draft_id=$1::uuid AND status='pending' RETURNING id::text`,[draftId])
    const token=crypto.randomBytes(32).toString('base64url')
    const tokenHash=crypto.createHash('sha256').update(token).digest('hex')
    const inviteId=crypto.randomUUID()
    const row=(await client.query<InviteRow>(`INSERT INTO admin_onboarding_invites(id,draft_id,token_hash,created_by_admin_id,expires_at)
      VALUES($1::uuid,$2::uuid,$3,$4::bigint,NOW()+INTERVAL '${INVITE_TTL}') RETURNING ${inviteColumns}`,
      [inviteId,draftId,tokenHash,admin.id])).rows[0]!
    await recordAudit({admin,action:'onboarding.invite_create',entityType:'onboarding_invite',entityId:row.id,
      after:{status:row.status,expiresAt:row.expires_at},metadata:{draftId,supersededInviteCount:revoked.rowCount||0}},client)
    await client.query('COMMIT')
    return {...inviteResponse(row),token}
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>undefined)
    unavailable(error)
  } finally { client.release() }
}

export async function revokeOnboardingInvite(admin: AdminPrincipal, id: string, inviteId: string) {
  requireInviteFeatureEnabled()
  requireSuperAdmin(admin)
  await requireOnboardingAccess(admin)
  const draftId=uuid(id),invite=uuid(inviteId)
  await inviteReady(admin)
  const client=await connection()
  try {
    await client.query('BEGIN')
    await ownedDraftWithPreparedScope(client,admin,draftId)
    const before=(await client.query<InviteRow>(`SELECT ${inviteColumns} FROM admin_onboarding_invites
      WHERE id=$1::uuid AND draft_id=$2::uuid FOR UPDATE`,[invite,draftId])).rows[0]
    if(!before) throw new HttpError(404,'ONBOARDING_INVITE_NOT_FOUND','Приглашение не найдено или недоступно.')
    if(before.status==='claimed') throw new HttpError(409,'ONBOARDING_INVITE_ALREADY_CLAIMED','Приглашение уже использовано. Отзыв ссылки не отменяет уже выданный доступ.')
    if(before.status==='revoked') { await client.query('COMMIT');return inviteResponse(before) }
    const row=(await client.query<InviteRow>(`UPDATE admin_onboarding_invites SET status='revoked',revoked_at=NOW()
      WHERE id=$1::uuid RETURNING ${inviteColumns}`,[invite])).rows[0]!
    await recordAudit({admin,action:'onboarding.invite_revoke',entityType:'onboarding_invite',entityId:row.id,
      before:{status:before.status},after:{status:row.status},metadata:{draftId}},client)
    await client.query('COMMIT')
    return inviteResponse(row)
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>undefined)
    unavailable(error)
  } finally { client.release() }
}

const inviteTokenPattern=/^[A-Za-z0-9_-]{16,256}$/
const inviteNotFound=()=>new HttpError(404,'ONBOARDING_INVITE_NOT_FOUND','Приглашение недействительно, использовано или истекло.')
const inviteClaimInvalid=()=>new HttpError(400,'ONBOARDING_INVITE_CLAIM_INVALID','Проверьте email, имя и пароль.')
function requireInviteFeatureEnabled(): void {
  if(config.enableOnboardingInvitations)throw new HttpError(410,'ONBOARDING_INVITE_REISSUE_REQUIRED','Попросите владельца создать новое приглашение в разделе «Приглашения».')
  if(!config.enableWrites||!config.enableOnboardingDrafts) throw new HttpError(403,'ONBOARDING_DISABLED','Мастер подключения пока выключен.')
}

// Public (unauthenticated): shows only the venue/company name for a still-pending, unexpired link.
export async function getOnboardingInvitePreview(req: IncomingMessage, tokenRaw: unknown) {
  requireInviteFeatureEnabled()
  enforceRateLimit(`onboarding-invite-preview:${requestIp(req)}`,30,60_000)
  const token=String(tokenRaw??'')
  if(!inviteTokenPattern.test(token)) throw inviteNotFound()
  try {
    const result=await pool.query<{venue_name:string;company_name:string}>(`SELECT v.name AS venue_name,c.name AS company_name
      FROM admin_onboarding_invites i
      JOIN admin_onboarding_scopes s ON s.draft_id=i.draft_id
      JOIN companies c ON c.id=s.company_id
      JOIN venues v ON v.id=s.venue_id
      WHERE i.token_hash=$1 AND i.status='pending' AND i.expires_at>NOW()`,[sha256(token)])
    const row=result.rows[0]
    if(!row) throw inviteNotFound()
    return {venueName:row.venue_name,companyName:row.company_name}
  } catch(error) {
    if(error instanceof HttpError) throw error
    unavailable(error)
  }
}

// Public (unauthenticated): redeems a pending link exactly once into a brand-new VENUE_ADMIN
// account with owner access to the prepared company. Never attaches access to an existing
// account — a colliding email is refused, so this never silently widens someone else's access.
export async function claimOnboardingInvite(req: IncomingMessage, res: ServerResponse, raw: unknown) {
  requireInviteFeatureEnabled()
  enforceRateLimit(`onboarding-invite-claim:${requestIp(req)}`,20,15*60_000)
  if(!raw||typeof raw!=='object'||Array.isArray(raw)) throw inviteClaimInvalid()
  const body=raw as Record<string,unknown>
  if(Object.keys(body).some(key=>!['token','email','displayName','password'].includes(key))) throw inviteClaimInvalid()
  const token=String(body.token??'')
  if(!inviteTokenPattern.test(token)) throw inviteNotFound()
  const email=normalizeEmail(body.email)
  if(!email||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw inviteClaimInvalid()
  const displayName=String(body.displayName??'').trim()
  if(!displayName||displayName.length>120||Array.from(displayName).some(character=>{const code=character.charCodeAt(0);return code<=31||code===127}))throw inviteClaimInvalid()
  const password=String(body.password??'')
  const client=await connection()
  try {
    await client.query('BEGIN')
    const invite=(await client.query<InviteRow>(`SELECT ${inviteColumns} FROM admin_onboarding_invites
      WHERE token_hash=$1 AND status='pending' AND expires_at>NOW() FOR UPDATE`,[sha256(token)])).rows[0]
    if(!invite) throw inviteNotFound()
    const scope=await loadScope(client,invite.draft_id)
    if(!scope||!scopeIsConsistent(scope)) throw new HttpError(409,'ONBOARDING_SCOPE_REQUIRED','Область заведения больше не подготовлена.')
    const colliding=await client.query('SELECT 1 FROM admin_accounts WHERE LOWER(email)=$1 LIMIT 1',[email])
    if(colliding.rowCount) throw new HttpError(409,'ONBOARDING_ACCOUNT_EXISTS','Учётная запись с этим email уже существует. Попросите владельца выдать доступ вручную.')
    // hashPassword enforces the same length policy as the admin login/password-change flow.
    const passwordHash=hashPassword(password)
    const account=(await client.query<{id:string;email:string;display_name:string;role:'SUPER_ADMIN'|'VENUE_ADMIN'}>(
      `INSERT INTO admin_accounts(email,display_name,role,password_hash) VALUES($1,$2,'VENUE_ADMIN',$3)
       RETURNING id::text,email,display_name,role`,[email,displayName,passwordHash])).rows[0]!
    await client.query(`INSERT INTO admin_company_access(admin_id,company_id,access_kind) VALUES($1::bigint,$2::bigint,'owner')`,
      [account.id,scope.company_id])
    await client.query(`UPDATE admin_onboarding_invites SET status='claimed',claimed_at=NOW(),claimed_admin_id=$2::bigint WHERE id=$1::uuid`,
      [invite.id,account.id])
    const principal:AdminPrincipal={id:account.id,email:account.email,displayName:account.display_name,role:account.role}
    const auditScope:VenueScope={id:scope.venue_id,companyId:scope.company_id,companyCode:scope.company_code,companyName:scope.company_name,
      code:scope.venue_code,name:scope.venue_name,address:scope.venue_address,legacyBarId:null,accessKind:'owner'}
    await recordAudit({admin:principal,scope:auditScope,action:'onboarding.invite_claim',entityType:'onboarding_invite',entityId:invite.id,
      after:{status:'claimed'},metadata:{draftId:invite.draft_id,newAdminId:account.id}},client)
    const sessionToken=randomToken(32)
    const expiresAt=new Date(Date.now()+config.sessionTtlMs)
    await client.query(`INSERT INTO admin_sessions(token_hash,admin_id,expires_at,user_agent,ip_hash) VALUES($1,$2::bigint,$3,$4,$5)`,
      [sha256(sessionToken),account.id,expiresAt.toISOString(),String(req.headers['user-agent']||'').slice(0,500),hashIp(req)])
    await client.query('COMMIT')
    setSessionCookie(res,sessionToken)
    return {admin:principal,csrfToken:csrfTokenFor(sessionToken)}
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>undefined)
    if(error instanceof HttpError) throw error
    if((error as {code?:string})?.code==='23505') throw new HttpError(409,'ONBOARDING_ACCOUNT_EXISTS','Учётная запись с этим email уже существует. Попросите владельца выдать доступ вручную.')
    unavailable(error)
  } finally { client.release() }
}
