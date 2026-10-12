import crypto from 'node:crypto'
import type { PoolClient, QueryResultRow } from 'pg'
import { recordAudit } from './audit.js'
import { config } from './config.js'
import { pool } from './db.js'
import { requireSuperAdmin } from './tenant.js'
import { HttpError, type AdminPrincipal } from './types.js'

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
const fields = ['companyId','companyName','venueName','address','timeZone','venueType','ownerEmail'] as const
const columns = 'id::text,request_key::text,initial_hash,data,status,revision,updated_at::text'
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const invalid = () => new HttpError(400,'ONBOARDING_INVALID','Проверьте данные заведения. Ключи интеграций на этом шаге не принимаются.')

function record(raw: unknown, allowed: readonly string[]): Record<string,unknown> {
  if(!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid()
  const value = raw as Record<string,unknown>
  if(Object.keys(value).some(key=>!allowed.includes(key))) throw invalid()
  return value
}
function text(raw: unknown, max: number, required=false): string {
  if(raw !== undefined && typeof raw !== 'string') throw invalid()
  const value = String(raw ?? '').trim()
  if(value.length>max || (required&&!value) || /[\u0000-\u001f\u007f]/.test(value)) throw invalid()
  return value
}
function uuid(raw: unknown): string {
  if(typeof raw!=='string'||!uuidPattern.test(raw)) throw invalid()
  return raw.toLowerCase()
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
async function connection(): Promise<PoolClient> {
  try {return await pool.connect()} catch(error) {unavailable(error)}
}
function response(row: DraftRow) {
  return {id:row.id,requestKey:row.request_key,data:row.data,status:row.status,revision:row.revision,updatedAt:row.updated_at}
}
function unavailable(error: unknown): never {
  if(error instanceof HttpError) throw error
  // Database errors may contain entire rows. Do not send/log draft contacts or bodies.
  throw new HttpError(503,'ONBOARDING_UNAVAILABLE','Не удалось подтвердить сохранение черновика. Повторите сохранение.')
}
async function companyAvailable(client: PoolClient, data: OnboardingData): Promise<void> {
  if(!data.companyId) return
  const result=await client.query('SELECT id FROM companies WHERE id=$1::bigint AND active=TRUE FOR SHARE',[data.companyId])
  if(!result.rowCount) throw new HttpError(404,'ONBOARDING_COMPANY_NOT_FOUND','Организация недоступна. Выберите другую организацию.')
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
