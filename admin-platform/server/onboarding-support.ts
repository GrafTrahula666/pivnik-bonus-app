import crypto from 'node:crypto'
import type {PoolClient} from 'pg'
import {config} from './config.js'
import {pool} from './db.js'
import {recordAudit} from './audit.js'
import {lockOnboardingDraftAccess,onboardingDraftAccessSql,requireWritableOnboarding} from './onboarding-access.js'
import {requireSuperAdmin} from './tenant.js'
import {HttpError,type AdminPrincipal,type VenueScope} from './types.js'

const topics=['connection','customer_data','access','activation'] as const
type Topic=typeof topics[number]
interface Ticket {id:string;draft_id:string;topic:Topic;status:'recorded';created_at:string}
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function uuid(raw:unknown){
  if(typeof raw!=='string'||!uuidPattern.test(raw))throw new HttpError(400,'ONBOARDING_SUPPORT_INVALID','Проверьте данные обращения.')
  return raw.toLowerCase()
}
function enabled(){
  if(!config.enableWrites||!config.enableOnboardingDrafts||!config.enableOnboardingSupport)
    throw new HttpError(403,'ONBOARDING_SUPPORT_DISABLED','Сохранение обращений пока недоступно.')
}
function unavailable(error:unknown):never{
  if(error instanceof HttpError)throw error
  throw new HttpError(503,'ONBOARDING_SUPPORT_UNAVAILABLE','Не удалось подтвердить сохранение обращения. Обновите список перед повтором.')
}
const response=(row:Ticket)=>({id:row.id,draftId:row.draft_id,topic:row.topic,status:row.status,createdAt:row.created_at})
// Only enumerated topics are persisted. No owner text, credentials, invitation
// URLs, customer data or untrusted provider errors enter the queue or audit.
export async function onboardingSupport(admin:AdminPrincipal,rawId:string,raw?:unknown){
  enabled()
  const draftId=uuid(rawId)
  let command:{topic:Topic}|undefined
  if(raw!==undefined){
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(key=>key!=='topic'))
      throw new HttpError(400,'ONBOARDING_SUPPORT_INVALID','Выберите причину обращения. Произвольный текст и ключи здесь не принимаются.')
    const value=raw as Record<string,unknown>
    if(!topics.includes(value.topic as Topic))throw new HttpError(400,'ONBOARDING_SUPPORT_INVALID','Выберите причину обращения.')
    command={topic:value.topic as Topic}
  }
  let client:PoolClient|undefined
  try{
    client=await pool.connect();await client.query('BEGIN')
    const account=await client.query('SELECT id FROM admin_accounts WHERE id=$1::bigint AND active=TRUE AND role=$2 FOR SHARE',[admin.id,admin.role])
    if(!account.rows.length)throw new HttpError(403,'ONBOARDING_ACCESS_REQUIRED','Доступ к панели отозван.')
    await requireWritableOnboarding(admin,true,client)
    await lockOnboardingDraftAccess(client,admin,draftId)
    // Serialize retry/category dedup with other commands for the same draft.
    const draft=await client.query(`SELECT draft.id FROM admin_onboarding_drafts draft WHERE draft.id=$1::uuid
      AND ${onboardingDraftAccessSql('draft','$2',true)} FOR UPDATE`,[draftId,admin.id])
    if(!draft.rows.length)throw new HttpError(404,'ONBOARDING_DRAFT_NOT_FOUND','Черновик не найден или недоступен.')
    const source=await client.query<VenueScope>(`SELECT venue.id::text,venue.company_id::text AS "companyId",
      company.code AS "companyCode",company.name AS "companyName",venue.code,venue.name,venue.address,venue.legacy_bar_id::text AS "legacyBarId"
      FROM admin_onboarding_scopes scope JOIN venues venue ON venue.id=scope.venue_id AND venue.company_id=scope.company_id
      JOIN companies company ON company.id=scope.company_id
      JOIN admin_onboarding_drafts draft ON draft.id=scope.draft_id
      WHERE scope.draft_id=$1::uuid AND (draft.company_id IS NULL OR draft.company_id=scope.company_id)`,[draftId])
    const scope=source.rows[0]
    if(!scope)throw new HttpError(409,'ONBOARDING_SUPPORT_SCOPE_REQUIRED','Сначала подготовьте область заведения.')
    if(command){
      const inserted=await client.query<Ticket>(`INSERT INTO admin_onboarding_support_requests(id,draft_id,created_by_admin_id,topic)
        VALUES($1::uuid,$2::uuid,$3::bigint,$4) ON CONFLICT(draft_id,topic) DO NOTHING
        RETURNING id::text,draft_id::text,topic,status,created_at::text`,[crypto.randomUUID(),draftId,admin.id,command.topic])
      if(inserted.rows[0])await recordAudit({admin,action:'onboarding.support_recorded',entityType:'onboarding_support_request',
        entityId:inserted.rows[0].id,scope,metadata:{draftId,topic:command.topic,status:'recorded'}},client)
    }
    const tickets=await client.query<Ticket>(`SELECT id::text,draft_id::text,topic,status,created_at::text
      FROM admin_onboarding_support_requests WHERE draft_id=$1::uuid ORDER BY created_at DESC,id`,[draftId])
    await client.query('COMMIT')
    return {schemaVersion:1,draftId,scope:{companyId:scope.companyId,venueId:scope.id},
      delivery:'internal_queue' as const,externalNotificationSent:false as const,requests:tickets.rows.map(response)}
  }catch(error){if(client)await client.query('ROLLBACK').catch(()=>undefined);unavailable(error)}
  finally{client?.release()}
}

// Platform operators read the queue explicitly; this is not an external
// developer grant and never grants access to a venue or its customer database.
export async function onboardingSupportQueue(admin:AdminPrincipal,offset:number){
  enabled();requireSuperAdmin(admin)
  let client:PoolClient|undefined
  try{
    client=await pool.connect();await client.query('BEGIN')
    const account=await client.query("SELECT id FROM admin_accounts WHERE id=$1::bigint AND active=TRUE AND role='SUPER_ADMIN' FOR SHARE",[admin.id])
    if(!account.rows.length)throw new HttpError(403,'FORBIDDEN','Доступ к очереди отозван.')
    const rows=await client.query<Ticket&{company_id:string;venue_id:string}>(`SELECT ticket.id::text,ticket.draft_id::text,ticket.topic,ticket.status,ticket.created_at::text,
      scope.company_id::text,scope.venue_id::text FROM admin_onboarding_support_requests ticket
      JOIN admin_onboarding_scopes scope ON scope.draft_id=ticket.draft_id
      ORDER BY ticket.created_at DESC,ticket.id LIMIT 26 OFFSET $1`,[offset])
    await recordAudit({admin,action:'onboarding.support_queue_read',entityType:'onboarding_support_queue',metadata:{offset,count:Math.min(25,rows.rows.length)}},client)
    await client.query('COMMIT')
    return {schemaVersion:1,requests:rows.rows.slice(0,25).map(row=>({...response(row),scope:{companyId:row.company_id,venueId:row.venue_id}})),
      nextOffset:rows.rows.length>25?offset+25:null}
  }catch(error){if(client)await client.query('ROLLBACK').catch(()=>undefined);unavailable(error)}
  finally{client?.release()}
}
