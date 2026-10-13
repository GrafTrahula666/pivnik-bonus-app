import crypto from 'node:crypto'
import type { PoolClient,QueryResultRow } from 'pg'
import { recordAudit } from './audit.js'
import { config } from './config.js'
import { pool } from './db.js'
import { canManageOnboardingInvitations } from './onboarding-access.js'
import { hashPassword,normalizeEmail,sha256 } from './security.js'
import { HttpError,type AdminPrincipal } from './types.js'

interface InviteRow extends QueryResultRow{
  id:string;creator_admin_id:string;company_id:string;venue_id:string|null;draft_id:string|null
  role:'owner'|'manager'|'viewer';request_key:string;fingerprint:string;token_hash:string
  expires_at:string;revoked_at:string|null;accepted_at:string|null;accepted_by:string|null;created_at:string
  company_name?:string;venue_name?:string|null
}
const columns='id::text,created_by_admin_id::text AS creator_admin_id,company_id::text,venue_id::text,draft_id::text,role,request_key::text,fingerprint,token_hash,expires_at::text,revoked_at::text,claimed_at::text AS accepted_at,claimed_admin_id::text AS accepted_by,created_at::text'
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const invalid=()=>new HttpError(400,'INVITATION_INVALID','Проверьте организацию, точку, роль и срок приглашения.')
function record(raw:unknown,fields:string[]):Record<string,unknown>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(key=>!fields.includes(key)))throw invalid()
  return raw as Record<string,unknown>
}
function id(raw:unknown):string{
  if(typeof raw!=='string'||!(/^[1-9]\d{0,18}$/).test(raw)||BigInt(raw)>9223372036854775807n)throw invalid()
  return raw
}
function token(raw:unknown):string{
  if(typeof raw!=='string'||!/^SVI-[A-Za-z0-9_-]{43}$/.test(raw))throw new HttpError(410,'INVITATION_UNAVAILABLE','Приглашение недоступно. Попросите владельца создать новое.')
  return raw
}
function gate(){
  if(!config.enableWrites||!config.enableOnboardingDrafts||!config.enableOnboardingInvitations)throw new HttpError(403,'INVITATIONS_DISABLED','Приглашения пока выключены.')
  if(config.csrfSecret.length<32)throw new HttpError(503,'INVITATION_KEY_NOT_CONFIGURED','Защищённая выдача приглашений не настроена.')
}
function code(row:InviteRow):string{
  return 'SVI-'+crypto.createHmac('sha256',config.csrfSecret)
    .update(`spaceverse-invite-v1\0${row.id}\0${row.creator_admin_id}\0${row.request_key}`).digest('base64url')
}
function state(row:InviteRow){
  return row.revoked_at?'revoked':row.accepted_at?'consumed':new Date(row.expires_at).getTime()<=Date.now()?'expired':'active'
}
function response(row:InviteRow){
  return {id:row.id,companyId:row.company_id,venueId:row.venue_id,draftId:row.draft_id,role:row.role,
    expiresAt:row.expires_at,singleUse:true,status:state(row),createdAt:row.created_at,acceptedAt:row.accepted_at,
    companyName:row.company_name,venueName:row.venue_name}
}
function unavailable(error:unknown):never{
  if(error instanceof HttpError)throw error
  throw new HttpError(503,'INVITATION_STORAGE_UNAVAILABLE','Не удалось подтвердить приглашение. Повторите тот же запрос.')
}
async function ready(){
  gate()
  const result=await pool.query<{ready:boolean}>("SELECT to_regclass('public.admin_onboarding_invites') IS NOT NULL AND to_regclass('public.admin_onboarding_access') IS NOT NULL AS ready")
  if(!result.rows[0]?.ready)throw new HttpError(503,'INVITATION_SCHEMA_NOT_CONFIGURED','Схема приглашений ещё не подготовлена. Нужна ручная миграция 011.')
}
async function ownerTarget(client:PoolClient,admin:AdminPrincipal,companyId:string,venueId:string|null){
  // Keep the authority used by this transaction valid until COMMIT.
  if(admin.role!=='SUPER_ADMIN'){
    await client.query(`SELECT admin_id FROM admin_company_access WHERE admin_id=$1::bigint
      AND company_id=$2::bigint AND access_kind='owner' FOR SHARE`,[admin.id,companyId])
    await client.query(`SELECT invitation_id FROM admin_onboarding_access WHERE admin_id=$1::bigint
      AND company_id=$2::bigint AND role='owner' AND revoked_at IS NULL
      AND (venue_id IS NULL OR venue_id=$3::bigint) ORDER BY invitation_id FOR SHARE`,[admin.id,companyId,venueId])
  }
  const owner=admin.role==='SUPER_ADMIN'||(await client.query(`SELECT 1 FROM admin_company_access
    WHERE admin_id=$1::bigint AND company_id=$2::bigint AND access_kind='owner'
    UNION ALL SELECT 1 FROM admin_onboarding_access WHERE admin_id=$1::bigint AND company_id=$2::bigint
      AND role='owner' AND revoked_at IS NULL AND (venue_id IS NULL OR venue_id=$3::bigint) LIMIT 1`,
  [admin.id,companyId,venueId])).rows.length>0
  if(!owner)throw new HttpError(403,'INVITATION_OWNER_REQUIRED','Приглашение создаёт владелец этой организации или точки.')
  const company=(await client.query<{id:string;name:string;active:boolean}>(`SELECT id::text,name,active FROM companies WHERE id=$1::bigint FOR SHARE`,[companyId])).rows[0]
  if(!company)throw new HttpError(404,'INVITATION_TARGET_NOT_FOUND','Организация недоступна.')
  let draftId:string|null=null
  if(venueId){
    const target=(await client.query<{draft_id:string}>(`SELECT scope.draft_id::text FROM admin_onboarding_scopes scope
      JOIN admin_onboarding_drafts draft ON draft.id=scope.draft_id
      JOIN venues venue ON venue.id=scope.venue_id AND venue.company_id=scope.company_id
      WHERE scope.company_id=$1::bigint AND scope.venue_id=$2::bigint
        AND (draft.admin_id=$3::bigint OR EXISTS(SELECT 1 FROM admin_company_access
          WHERE admin_id=$3::bigint AND company_id=scope.company_id AND access_kind='owner')
          OR EXISTS(SELECT 1 FROM admin_onboarding_access WHERE admin_id=$3::bigint
            AND company_id=scope.company_id AND (venue_id IS NULL OR venue_id=scope.venue_id)
            AND role='owner' AND revoked_at IS NULL))
      FOR SHARE OF scope,venue`,[companyId,venueId,admin.id])).rows[0]
    if(!target)throw new HttpError(404,'INVITATION_TARGET_NOT_PREPARED','Сначала подготовьте эту точку в мастере владельца.')
    draftId=target.draft_id
  }else if(!company.active){
    const owned=await client.query(`SELECT 1 FROM admin_onboarding_scopes scope JOIN admin_onboarding_drafts draft ON draft.id=scope.draft_id
      WHERE scope.company_id=$1::bigint AND (draft.admin_id=$2::bigint OR EXISTS(SELECT 1 FROM admin_company_access
        WHERE admin_id=$2::bigint AND company_id=scope.company_id AND access_kind='owner') OR EXISTS(SELECT 1 FROM admin_onboarding_access
        WHERE admin_id=$2::bigint AND company_id=scope.company_id AND venue_id IS NULL AND role='owner' AND revoked_at IS NULL))`,[companyId,admin.id])
    if(!owned.rows.length)throw new HttpError(404,'INVITATION_TARGET_NOT_FOUND','Организация недоступна.')
  }
  return draftId
}

export async function createOnboardingInvitation(admin:AdminPrincipal,raw:unknown){
  await ready()
  const body=record(raw,['requestKey','companyId','venueId','role','expiresInHours'])
  if(typeof body.requestKey!=='string'||!uuid.test(body.requestKey))throw invalid()
  const companyId=id(body.companyId),venueId=body.venueId===null||body.venueId===undefined?null:id(body.venueId)
  if(!['owner','manager','viewer'].includes(String(body.role))||typeof body.expiresInHours!=='number'
    ||!Number.isInteger(body.expiresInHours)||body.expiresInHours<1||body.expiresInHours>168)throw invalid()
  const requestKey=body.requestKey.toLowerCase(),role=body.role as InviteRow['role']
  const fingerprint=sha256(JSON.stringify({companyId,venueId,role,expiresInHours:body.expiresInHours}))
  const client=await pool.connect()
  try{
    await client.query('BEGIN')
    const draftId=await ownerTarget(client,admin,companyId,venueId)
    const inviteId=crypto.randomUUID()
    const generated=code({id:inviteId,creator_admin_id:admin.id,request_key:requestKey} as InviteRow)
    let row=(await client.query<InviteRow>(`INSERT INTO admin_onboarding_invites
      (id,created_by_admin_id,company_id,venue_id,draft_id,role,request_key,fingerprint,token_hash,expires_at)
      VALUES($1::uuid,$2::bigint,$3::bigint,$4::bigint,$5::uuid,$6,$7::uuid,$8,$9,NOW()+$10*INTERVAL '1 hour')
      ON CONFLICT(created_by_admin_id,request_key) DO NOTHING RETURNING ${columns}`,
    [inviteId,admin.id,companyId,venueId,draftId,role,requestKey,fingerprint,sha256(generated),body.expiresInHours])).rows[0]
    if(!row){
      row=(await client.query<InviteRow>(`SELECT ${columns} FROM admin_onboarding_invites
        WHERE created_by_admin_id=$1::bigint AND request_key=$2::uuid`,[admin.id,requestKey])).rows[0]!
      if(!row||row.fingerprint!==fingerprint)throw new HttpError(409,'INVITATION_REQUEST_CONFLICT','Этот запрос использован для другого приглашения.')
    }else await recordAudit({admin,action:'onboarding.invitation_create',entityType:'onboarding_invitation',entityId:row.id,
      after:{role,companyId,venueId,singleUse:true},metadata:{expiresInHours:body.expiresInHours}},client)
    await client.query('COMMIT')
    const inviteToken=code(row)
    if(sha256(inviteToken)!==row.token_hash)throw new HttpError(409,'INVITATION_KEY_CHANGED','Ключ выдачи изменился. Отзовите приглашение и создайте новое.')
    return {invitation:response(row),token:inviteToken,linkPath:'/#invite='+inviteToken}
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);unavailable(error)}finally{client.release()}
}
export async function listOnboardingInvitations(admin:AdminPrincipal){
  await ready()
  try{
    const result=await pool.query<InviteRow>(`SELECT ${columns} FROM admin_onboarding_invites
      WHERE created_by_admin_id=$1::bigint AND request_key IS NOT NULL ORDER BY created_at DESC,id LIMIT 100`,[admin.id])
    let companies:{id:string;name:string}[]=[],venues:{id:string;companyId:string;name:string;draftId:string}[]=[]
    if(await canManageOnboardingInvitations(admin)){
      companies=(await pool.query<{id:string;name:string}>(`SELECT company.id::text,company.name FROM companies company
        WHERE ($2=TRUE OR EXISTS(SELECT 1 FROM admin_company_access WHERE admin_id=$1::bigint AND company_id=company.id AND access_kind='owner')
          OR EXISTS(SELECT 1 FROM admin_onboarding_access WHERE admin_id=$1::bigint AND company_id=company.id AND venue_id IS NULL AND role='owner' AND revoked_at IS NULL))
          AND (company.active=TRUE OR EXISTS(SELECT 1 FROM admin_onboarding_scopes scope JOIN admin_onboarding_drafts draft ON draft.id=scope.draft_id
            WHERE scope.company_id=company.id AND (draft.admin_id=$1::bigint
              OR EXISTS(SELECT 1 FROM admin_company_access WHERE admin_id=$1::bigint AND company_id=company.id AND access_kind='owner')
              OR EXISTS(SELECT 1 FROM admin_onboarding_access WHERE admin_id=$1::bigint AND company_id=company.id
                AND venue_id IS NULL AND role='owner' AND revoked_at IS NULL)))) ORDER BY company.name,company.id`,[admin.id,admin.role==='SUPER_ADMIN'])).rows
      venues=(await pool.query<{id:string;companyId:string;name:string;draftId:string}>(`SELECT venue.id::text,venue.company_id::text AS "companyId",venue.name,scope.draft_id::text AS "draftId"
        FROM venues venue JOIN admin_onboarding_scopes scope ON scope.venue_id=venue.id AND scope.company_id=venue.company_id
        JOIN admin_onboarding_drafts draft ON draft.id=scope.draft_id WHERE draft.admin_id=$1::bigint
          OR EXISTS(SELECT 1 FROM admin_company_access WHERE admin_id=$1::bigint AND company_id=venue.company_id AND access_kind='owner')
          OR EXISTS(SELECT 1 FROM admin_onboarding_access WHERE admin_id=$1::bigint AND company_id=venue.company_id
            AND (venue_id IS NULL OR venue_id=venue.id) AND role='owner' AND revoked_at IS NULL)
        ORDER BY venue.name,venue.id`,[admin.id])).rows
    }
    return {invitations:result.rows.map(response),companies,venues}
  }catch(error){unavailable(error)}
}
export async function revokeOnboardingInvitation(admin:AdminPrincipal,inviteId:string){
  await ready()
  if(!uuid.test(inviteId))throw invalid()
  const client=await pool.connect()
  try{
    await client.query('BEGIN')
    const row=(await client.query<InviteRow>(`SELECT ${columns} FROM admin_onboarding_invites
      WHERE id=$1::uuid AND created_by_admin_id=$2::bigint FOR UPDATE`,[inviteId,admin.id])).rows[0]
    if(!row)throw new HttpError(404,'INVITATION_NOT_FOUND','Приглашение не найдено или недоступно.')
    if(!row.revoked_at){
      await client.query("UPDATE admin_onboarding_invites SET revoked_at=NOW(),status='revoked' WHERE id=$1::uuid",[inviteId])
      await client.query('UPDATE admin_onboarding_access SET revoked_at=NOW() WHERE invitation_id=$1::uuid AND revoked_at IS NULL',[inviteId])
      await recordAudit({admin,action:'onboarding.invitation_revoke',entityType:'onboarding_invitation',entityId:inviteId,
        after:{revoked:true},metadata:{accessRevoked:Boolean(row.accepted_at)}},client)
    }
    await client.query('COMMIT')
    return {ok:true}
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);unavailable(error)}finally{client.release()}
}
export async function reopenOnboardingInvitation(admin:AdminPrincipal,inviteId:string){
  await ready()
  if(!uuid.test(inviteId))throw invalid()
  const client=await pool.connect()
  try{
    await client.query('BEGIN')
    const row=(await client.query<InviteRow>(`SELECT ${columns} FROM admin_onboarding_invites
      WHERE id=$1::uuid AND created_by_admin_id=$2::bigint FOR SHARE`,[inviteId,admin.id])).rows[0]
    if(!row)throw new HttpError(404,'INVITATION_NOT_FOUND','Приглашение не найдено или недоступно.')
    await ownerTarget(client,admin,row.company_id,row.venue_id)
    if(state(row)!=='active')throw new HttpError(410,'INVITATION_UNAVAILABLE','Приглашение уже недоступно. Создайте новое.')
    const inviteToken=code(row)
    if(sha256(inviteToken)!==row.token_hash)throw new HttpError(409,'INVITATION_KEY_CHANGED','Ключ выдачи изменился. Отзовите приглашение и создайте новое.')
    await recordAudit({admin,action:'onboarding.invitation_link_read',entityType:'onboarding_invitation',entityId:row.id},client)
    await client.query('COMMIT');return {invitation:response(row),linkPath:'/#invite='+inviteToken}
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);unavailable(error)}finally{client.release()}
}
export async function previewOnboardingInvitation(raw:unknown){
  await ready()
  const body=record(raw,['token']),inviteToken=token(body.token)
  const row=(await pool.query<InviteRow>(`SELECT i.id::text,i.company_id::text,i.venue_id::text,i.draft_id::text,
    i.role,i.expires_at::text,i.revoked_at::text,i.claimed_at::text AS accepted_at,i.created_at::text,
    company.name AS company_name,venue.name AS venue_name
    FROM admin_onboarding_invites i JOIN companies company ON company.id=i.company_id
    LEFT JOIN venues venue ON venue.id=i.venue_id AND venue.company_id=i.company_id WHERE i.token_hash=$1`,[sha256(inviteToken)])).rows[0]
  if(!row)throw new HttpError(410,'INVITATION_UNAVAILABLE','Приглашение недоступно. Попросите владельца создать новое.')
  return {invitation:response(row)}
}
export async function acceptOnboardingInvitation(admin:AdminPrincipal|null,raw:unknown){
  await ready()
  const body=record(raw,['token','email','displayName','password']),inviteToken=token(body.token)
  let email='',displayName='',passwordHash=''
  if(!admin){
    email=normalizeEmail(body.email)
    if(email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email)||typeof body.displayName!=='string'
      ||!body.displayName.trim()||body.displayName.length>80||/[\x00-\x1f\x7f]/.test(body.displayName)||typeof body.password!=='string')throw invalid()
    displayName=body.displayName.trim();passwordHash=hashPassword(body.password)
  }else if(['email','displayName','password'].some(key=>body[key]!==undefined))throw invalid()
  const client=await pool.connect()
  try{
    await client.query('BEGIN')
    const row=(await client.query<InviteRow>(`SELECT ${columns} FROM admin_onboarding_invites WHERE token_hash=$1 AND request_key IS NOT NULL FOR UPDATE`,[sha256(inviteToken)])).rows[0]
    if(!row||row.revoked_at)throw new HttpError(410,'INVITATION_REVOKED','Приглашение отозвано или недоступно. Попросите новое у владельца.')
    if(row.accepted_at){
      if(admin?.id!==row.accepted_by)throw new HttpError(409,'INVITATION_ALREADY_USED','Приглашение уже использовано. Войдите в учётную запись, которая его приняла.')
      await client.query('COMMIT');return {accepted:true,companyId:row.company_id,venueId:row.venue_id,draftId:row.draft_id,role:row.role,admin}
    }
    if(new Date(row.expires_at).getTime()<=Date.now())throw new HttpError(410,'INVITATION_EXPIRED','Срок приглашения истёк. Попросите владельца создать новое.')
    const issuer=(await client.query<{id:string;email:string;display_name:string;role:AdminPrincipal['role']}>(
      'SELECT id::text,email,display_name,role FROM admin_accounts WHERE id=$1::bigint AND active=TRUE',[row.creator_admin_id])).rows[0]
    if(!issuer)throw new HttpError(410,'INVITATION_ISSUER_UNAVAILABLE','Владелец приглашения больше не имеет доступа. Попросите новое приглашение.')
    await ownerTarget(client,{id:issuer.id,email:issuer.email,displayName:issuer.display_name,role:issuer.role},row.company_id,row.venue_id)
    let actor=admin
    if(!actor){
      const existing=await client.query('SELECT 1 FROM admin_accounts WHERE LOWER(email)=$1',[email])
      if(existing.rows.length)throw new HttpError(401,'INVITATION_LOGIN_REQUIRED','Войдите в существующую учётную запись, затем примите приглашение.')
      const account=(await client.query<{id:string}>(`INSERT INTO admin_accounts(email,display_name,role,password_hash)
        VALUES($1,$2,'VENUE_ADMIN',$3) RETURNING id::text`,[email,displayName,passwordHash])).rows[0]!
      actor={id:account.id,email,displayName,role:'VENUE_ADMIN'}
    }
    await client.query(`INSERT INTO admin_onboarding_access(invitation_id,admin_id,company_id,venue_id,draft_id,role)
      VALUES($1::uuid,$2::bigint,$3::bigint,$4::bigint,$5::uuid,$6)`,[row.id,actor.id,row.company_id,row.venue_id,row.draft_id,row.role])
    await client.query("UPDATE admin_onboarding_invites SET claimed_at=NOW(),claimed_admin_id=$2::bigint,status='claimed' WHERE id=$1::uuid",[row.id,actor.id])
    await recordAudit({admin:actor,action:'onboarding.invitation_accept',entityType:'onboarding_invitation',entityId:row.id,
      after:{companyId:row.company_id,venueId:row.venue_id,role:row.role},metadata:{creatorAdminId:row.creator_admin_id}},client)
    await client.query('COMMIT')
    return {accepted:true,companyId:row.company_id,venueId:row.venue_id,draftId:row.draft_id,role:row.role,admin:actor}
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);unavailable(error)}finally{client.release()}
}
