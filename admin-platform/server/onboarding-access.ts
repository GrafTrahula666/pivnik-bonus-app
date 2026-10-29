import type { PoolClient } from 'pg'
import { config } from './config.js'
import { pool } from './db.js'
import { HttpError, type AdminPrincipal } from './types.js'

export async function canUseOnboarding(admin:AdminPrincipal,write=false,db:Pick<PoolClient,'query'>=pool):Promise<boolean>{
  if(!config.enableWrites||!config.enableOnboardingDrafts)return false
  if(admin.role==='SUPER_ADMIN')return true
  if(!config.enableOnboardingInvitations)return false
  const role=write?"AND access.role IN ('owner','manager')":''
  const result=await db.query<{allowed:boolean}>(`SELECT (
    EXISTS(SELECT 1 FROM admin_company_access WHERE admin_id=$1::bigint AND access_kind='owner')
    OR EXISTS(SELECT 1 FROM admin_onboarding_access access WHERE access.admin_id=$1::bigint
      AND access.revoked_at IS NULL ${role})
  ) AS allowed`,[admin.id])
  return result.rows[0]?.allowed===true
}
export async function canManageOnboardingInvitations(admin:AdminPrincipal):Promise<boolean>{
  if(!config.enableWrites||!config.enableOnboardingDrafts||!config.enableOnboardingInvitations)return false
  if(admin.role==='SUPER_ADMIN')return true
  const result=await pool.query<{allowed:boolean}>(`SELECT (
    EXISTS(SELECT 1 FROM admin_company_access WHERE admin_id=$1::bigint AND access_kind='owner')
    OR EXISTS(SELECT 1 FROM admin_onboarding_access WHERE admin_id=$1::bigint AND role='owner' AND revoked_at IS NULL)
  ) AS allowed`,[admin.id])
  return result.rows[0]?.allowed===true
}
export async function requireWritableOnboarding(admin:AdminPrincipal,write=false,db:Pick<PoolClient,'query'>=pool):Promise<void>{
  if(!await canUseOnboarding(admin,write,db))throw new HttpError(403,'ONBOARDING_ACCESS_REQUIRED','Мастер недоступен или у вас нет прав на этот шаг.')
}
// Aliases/placeholders are supplied only by checked-in SQL, never request text.
export function onboardingDraftAccessSql(alias='admin_onboarding_drafts',actor='$2',write=false):string{
  const creator=`${alias}.admin_id=${actor}::bigint`
  if(!config.enableOnboardingInvitations)return creator
  const company=`COALESCE(${alias}.company_id,(SELECT scope_binding.company_id FROM admin_onboarding_scopes scope_binding WHERE scope_binding.draft_id=${alias}.id))`
  const roles=write?"AND access.role IN ('owner','manager')":''
  const creatorScope=`(${creator} AND (
    EXISTS(SELECT 1 FROM admin_accounts actor_account WHERE actor_account.id=${actor}::bigint
      AND actor_account.role='SUPER_ADMIN' AND actor_account.active=TRUE)
    OR EXISTS(SELECT 1 FROM admin_company_access owner_access WHERE owner_access.admin_id=${actor}::bigint
      AND owner_access.company_id=${company} AND owner_access.access_kind='owner')
    OR EXISTS(SELECT 1 FROM admin_onboarding_access access WHERE access.admin_id=${actor}::bigint
      AND access.company_id=${company} AND access.revoked_at IS NULL ${roles}
      AND (access.venue_id IS NULL OR access.draft_id=${alias}.id))))`
  return `(${creatorScope} OR EXISTS(SELECT 1 FROM admin_onboarding_access access
    WHERE access.admin_id=${actor}::bigint AND access.revoked_at IS NULL ${roles}
      AND (access.draft_id=${alias}.id OR (access.venue_id IS NULL AND access.role='owner'
        AND access.company_id=${company})))
    OR EXISTS(SELECT 1 FROM admin_company_access owner_access WHERE owner_access.admin_id=${actor}::bigint
      AND owner_access.company_id=${company} AND owner_access.access_kind='owner'))`
}
export async function requireOnboardingCompany(client:Pick<PoolClient,'query'>,admin:AdminPrincipal,companyId:string|null):Promise<void>{
  if(admin.role==='SUPER_ADMIN')return
  if(!companyId)throw new HttpError(403,'ONBOARDING_COMPANY_FORBIDDEN','Выберите организацию из приглашения.')
  await client.query(`SELECT admin_id FROM admin_company_access WHERE admin_id=$1::bigint AND company_id=$2::bigint AND access_kind='owner' FOR SHARE`,[admin.id,companyId])
  await client.query(`SELECT invitation_id FROM admin_onboarding_access WHERE admin_id=$1::bigint AND company_id=$2::bigint
    AND venue_id IS NULL AND role IN ('owner','manager') AND revoked_at IS NULL FOR SHARE`,[admin.id,companyId])
  const result=await client.query<{allowed:boolean}>(`SELECT (
    EXISTS(SELECT 1 FROM admin_company_access WHERE admin_id=$1::bigint AND company_id=$2::bigint AND access_kind='owner')
    OR EXISTS(SELECT 1 FROM admin_onboarding_access access WHERE access.admin_id=$1::bigint
      AND access.company_id=$2::bigint AND access.venue_id IS NULL
      AND access.role IN ('owner','manager') AND access.revoked_at IS NULL)
  ) AS allowed`,[admin.id,companyId])
  if(result.rows[0]?.allowed!==true)throw new HttpError(403,'ONBOARDING_COMPANY_FORBIDDEN','Эта организация не относится к вашему приглашению.')
}
// Hold the grants used by a mutation until COMMIT; revocation cannot race the
// earlier permission check and complete before a previously authorized write.
export async function lockOnboardingDraftAccess(client:Pick<PoolClient,'query'>,admin:AdminPrincipal,draftId:string):Promise<void>{
  if(!config.enableOnboardingInvitations)return
  await client.query(`SELECT access.invitation_id FROM admin_onboarding_access access
    WHERE access.admin_id=$1::bigint AND access.revoked_at IS NULL AND access.role IN ('owner','manager')
      AND (access.draft_id=$2::uuid OR (access.venue_id IS NULL AND access.company_id=(
        SELECT COALESCE(draft.company_id,scope.company_id) FROM admin_onboarding_drafts draft
          LEFT JOIN admin_onboarding_scopes scope ON scope.draft_id=draft.id WHERE draft.id=$2::uuid)))
    ORDER BY access.invitation_id FOR SHARE`,[admin.id,draftId])
  await client.query(`SELECT owner_access.admin_id FROM admin_company_access owner_access
    WHERE owner_access.admin_id=$1::bigint AND owner_access.access_kind='owner'
      AND owner_access.company_id=(SELECT COALESCE(draft.company_id,scope.company_id) FROM admin_onboarding_drafts draft
        LEFT JOIN admin_onboarding_scopes scope ON scope.draft_id=draft.id WHERE draft.id=$2::uuid) FOR SHARE`,[admin.id,draftId])
  const allowed=await client.query(`SELECT id FROM admin_onboarding_drafts WHERE id=$1::uuid
    AND ${onboardingDraftAccessSql('admin_onboarding_drafts','$2',true)}`,[draftId,admin.id])
  if(!allowed.rows.length)throw new HttpError(404,'ONBOARDING_DRAFT_NOT_FOUND','Черновик не найден или недоступен.')
}
export async function onboardingDraftPermissions(admin:AdminPrincipal,draftId:string){
  const result=await pool.query<{can_write:boolean;is_owner:boolean}>(`SELECT
    ${onboardingDraftAccessSql('draft','$2',true)} AS can_write,
    ($3::boolean OR EXISTS(SELECT 1 FROM admin_company_access WHERE admin_id=$2::bigint
      AND company_id=COALESCE(draft.company_id,(SELECT company_id FROM admin_onboarding_scopes WHERE draft_id=draft.id)) AND access_kind='owner') OR EXISTS(SELECT 1 FROM admin_onboarding_access
      WHERE admin_id=$2::bigint AND revoked_at IS NULL AND role='owner'
        AND (draft_id=draft.id OR (venue_id IS NULL AND company_id=COALESCE(draft.company_id,(SELECT company_id FROM admin_onboarding_scopes WHERE draft_id=draft.id)))))) AS is_owner
    FROM admin_onboarding_drafts draft WHERE draft.id=$1::uuid AND ${onboardingDraftAccessSql('draft','$2')}`,
  [draftId,admin.id,admin.role==='SUPER_ADMIN'])
  const row=result.rows[0]
  if(!row)throw new HttpError(404,'ONBOARDING_DRAFT_NOT_FOUND','Черновик не найден или недоступен.')
  return {canWrite:row.can_write,role:row.is_owner?'owner':row.can_write?'manager':'viewer'}
}
