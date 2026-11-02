// CHAT 03 / #24: unmounted Admin ownership gate for manual CRM contact writes.
// HTTP session, Origin, CSRF and rate-limits must be checked by a future route.
// No caller may turn a manual contact into an authenticated identity or wallet.
import type {Pool, PoolClient} from 'pg'
import {config} from './config.js'
import {recordAudit} from './audit.js'
import {loadOwnedOnboardingRuntimeSource} from './venue-onboarding.js'
import {HttpError, type AdminPrincipal} from './types.js'

type Database=Pick<Pool,'connect'>
type Manifest=Awaited<ReturnType<typeof loadOwnedOnboardingRuntimeSource>>['manifest']
type AuthorizedContext={manifest:Manifest; actorId:string}
type CreatedContact={contact:{id:string};requestKey:string}

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const hash=/^[0-9a-f]{64}$/
const denied=()=>new HttpError(404,'TENANT_CRM_CONTACT_SCOPE_DENIED','Заведение или разрешение на запись недоступно.')
const unavailable=()=>new HttpError(503,'TENANT_CRM_CONTACT_ACCESS_UNAVAILABLE','Не удалось подтвердить права на создание контакта.')

/**
 * This is a server-only authorization and audit adapter, NOT an HTTP endpoint.
 *
 * The metadata transaction holds current session, owner grant and prepared
 * draft locks until the tenant writer completes. A future route must call
 * requireCsrf and enforceOrigin, and must supply the hash of the actual
 * loadSession raw token, never anything from JSON or URL parameters.
 *
 * A separate tenant database cannot share the metadata COMMIT atomically.
 * Therefore the future writer must use its existing durable actor-bound
 * idempotency ledger; after an uncertain metadata audit COMMIT the same
 * request key must be replayable and the tenant ledger reconciled.
 */
export function createTenantCrmContactOwnerGate(options:{
  metadata:Database
  enabled?:()=>boolean
}) {
  return async function execute(
    admin:AdminPrincipal,
    sessionTokenHash:string,
    draftId:string,
    requestKey:string,
    write:(context:AuthorizedContext)=>Promise<CreatedContact>,
  ):Promise<CreatedContact>{
    if(!options.enabled?.()||!config.enableWrites||!config.enableOnboardingDrafts)
      throw new HttpError(403,'TENANT_CRM_CONTACT_CREATE_DISABLED','Создание контактов CRM пока выключено.')
    if(!uuid.test(draftId)||!uuid.test(requestKey)||!hash.test(sessionTokenHash)||
      !/^[1-9][0-9]{0,18}$/.test(admin.id)||typeof write!=='function')
      throw new HttpError(400,'TENANT_CRM_CONTACT_REQUEST_INVALID','Некорректный запрос создания контакта.')

    const client=await options.metadata.connect().catch(()=>{throw unavailable()})
    let inTransaction=false
    try{
      await client.query('BEGIN')
      inTransaction=true
      // Lock the actual authenticated Admin session and active account.
      // A revoked/expired session, even with an old principal snapshot,
      // cannot authorize a new contact.
      const session=await client.query(`SELECT session.admin_id::text
        FROM admin_sessions session
        JOIN admin_accounts account ON account.id=session.admin_id
        WHERE session.token_hash=$1 AND session.admin_id=$2::bigint
          AND session.expires_at>CLOCK_TIMESTAMP()
          AND account.active=TRUE AND account.role=$3
        FOR SHARE OF session,account`,[sessionTokenHash,admin.id,admin.role])
      if(session.rows.length!==1)throw denied()

      // The existing prepared-scope gate locks the draft and current grants.
      // It rejects foreign, revoked, unpublished and inconsistent sources.
      const source=await loadOwnedOnboardingRuntimeSource(client,admin,draftId,true)
      const scope=source.manifest.scope
      if(admin.role!=='SUPER_ADMIN'){
        const owner=await client.query(`SELECT admin_id FROM admin_company_access
          WHERE admin_id=$1::bigint AND company_id=$2::bigint AND access_kind='owner'
          FOR SHARE`,[admin.id,scope.companyId])
        const invited=await client.query(`SELECT invitation_id FROM admin_onboarding_access
          WHERE admin_id=$1::bigint AND company_id=$2::bigint AND role='owner'
            AND revoked_at IS NULL
            AND (draft_id=$3::uuid OR venue_id IS NULL)
          FOR SHARE`,[admin.id,scope.companyId,draftId])
        if(owner.rows.length===0&&invited.rows.length===0)throw denied()
      }

      const created=await write({manifest:source.manifest,actorId:admin.id})
      if(!created||!uuid.test(created.requestKey)||created.requestKey.toLowerCase()!==requestKey.toLowerCase()||
        typeof created.contact?.id!=='string'||!/^[1-9][0-9]{0,18}$/.test(created.contact.id))
        throw unavailable()
      // The earlier prepared-draft FOR UPDATE lock serializes every request
      // for this draft until metadata COMMIT. Check the audit *after* the
      // tenant writer confirms its actor-bound request-ledger result, so a
      // successful replay never emits another event. This is idempotent
      // within the verified draft, not a distributed two-DB transaction.
      const previousAudit=await client.query<{entity_type:string;entity_id:string|null;
        metadata:{source?:string;identityLinking?:boolean;walletCreated?:boolean}}>(
        `SELECT entity_type,entity_id,metadata FROM admin_audit_log
         WHERE admin_id=$1::bigint AND company_id=$2::bigint AND venue_id=$3::bigint
           AND action='crm.manual_contact_create_request'
           AND metadata->>'requestKey'=$4
         ORDER BY id ASC LIMIT 2`,
        [admin.id,scope.companyId,source.auditScope.id,requestKey.toLowerCase()])
      if(previousAudit.rows.length>1)throw unavailable()
      if(previousAudit.rows.length>0){
        // Even a pre-existing/corrupt audit must never be silently treated as
        // proof that the tenant contact or its scope matches the returned row.
        if(previousAudit.rows.some(row=>
          row.entity_type!=='crm_manual_contact'||row.entity_id!==created.contact.id||
          row.metadata?.source!=='dedicated_tenant'||row.metadata.identityLinking!==false||
          row.metadata.walletCreated!==false))throw unavailable()
      }else{
        await recordAudit({
          admin,scope:source.auditScope,action:'crm.manual_contact_create_request',
          entityType:'crm_manual_contact',entityId:created.contact.id,
          metadata:{requestKey:requestKey.toLowerCase(),source:'dedicated_tenant',
            identityLinking:false,walletCreated:false}
        },client as PoolClient)
      }
      await client.query('COMMIT')
      inTransaction=false
      return created
    }catch(error){
      if(inTransaction)await client.query('ROLLBACK').catch(()=>undefined)
      if(error instanceof HttpError)throw error
      throw unavailable()
    }finally{client.release()}
  }
}
