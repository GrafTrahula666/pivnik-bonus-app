import type {Pool} from 'pg'
import {createSpaceverseRuntimeManifest,resolveSpaceverseRuntime} from '../../spaceverse-runtime-manifest.js'
import {createSpaceverseCustomerDirectoryRepository,type SpaceverseCustomerDirectoryQuery} from '../../customer-directory-repository.js'
import {createSpaceverseCustomerWalletRepository} from '../../customer-wallet-repository.js'
import {recordAudit} from './audit.js'
import {config} from './config.js'
import {pool} from './db.js'
import {onboardingTargetRegistry} from './onboarding-database-registry.js'
import {onboardingAppConfig} from './venue-onboarding.js'
import {requireVenueAccess,resolveVenueScope} from './tenant.js'
import {HttpError,type AdminPrincipal,type VenueScope} from './types.js'

type Connectable=Pick<Pool,'connect'>
interface FrozenSource {
  draft_id:string;tenant_key:string;draft_revision:number;application_revision:number;
  application_config:unknown;company_id:string;venue_id:string
}
const sourceMissing=()=>new HttpError(409,'TENANT_CRM_SOURCE_NOT_CONFIGURED',
  'Для этой точки ещё не подтверждена отдельная клиентская база.')
const unavailable=()=>new HttpError(503,'TENANT_CRM_READ_UNAVAILABLE',
  'Не удалось проверить клиентский источник этой точки. Повторите попытку.')

export function validatePilotCrmQuery(url:URL):SpaceverseCustomerDirectoryQuery{
  const accepted=['q','limit','offset','sort','direction','wallet'] as const
  for(const key of url.searchParams.keys())
    if(!accepted.includes(key as typeof accepted[number])||url.searchParams.getAll(key).length!==1)
      throw new HttpError(400,'TENANT_CRM_PAGE_INVALID','Некорректные параметры поиска.')
  const numberValue=(key:'limit'|'offset',fallback:number,max:number)=>{
    const raw=url.searchParams.get(key)
    if(raw===null)return fallback
    if(!/^(0|[1-9]\d{0,6})$/.test(raw)||Number(raw)>max)
      throw new HttpError(400,'TENANT_CRM_PAGE_INVALID','Некорректная страница.')
    return Number(raw)
  }
  const q=url.searchParams.get('q')??'',sort=url.searchParams.get('sort')??'id'
  const direction=url.searchParams.get('direction')??'asc',wallet=url.searchParams.get('wallet')??'all'
  const limit=numberValue('limit',25,100),offset=numberValue('offset',0,1_000_000)
  if(q.length>100||limit<1||!['id','name','username'].includes(sort)||
    !['asc','desc'].includes(direction)||!['all','present','missing'].includes(wallet))
    throw new HttpError(400,'TENANT_CRM_PAGE_INVALID','Некорректные параметры поиска.')
  return {q,limit,offset,sort:sort as 'id'|'name'|'username',
    direction:direction as 'asc'|'desc',wallet:wallet as 'all'|'present'|'missing'}
}

// Pilot reader deliberately CANNOT activate a venue, publish a runtime or issue a license.
// The commercial production path needs a separate verified entitlement/activation gate.
export function createActiveTenantCrmPilotReader(options:{
  metadata:Connectable
  resolveTargetDatabase:(runtimeKey:string)=>Promise<Connectable|null>
  authorize?:(admin:AdminPrincipal,scope:VenueScope)=>Promise<void>
}){
  const authorize=options.authorize??async(admin:AdminPrincipal,scope:VenueScope)=>{
    const fresh=await resolveVenueScope(admin,scope.id)
    if(fresh.id!==scope.id||fresh.companyId!==scope.companyId||
      fresh.companyCode==='pivnik'||fresh.legacyBarId!==null)
      throw new HttpError(404,'VENUE_NOT_FOUND','Заведение не найдено или недоступно.')
    await requireVenueAccess(admin,fresh,'GET','clients','','')
  }
  async function frozenSource(admin:AdminPrincipal,scope:VenueScope){
    await authorize(admin,scope)
    const client=await options.metadata.connect()
    try{
      const found=await client.query<FrozenSource>(`SELECT
        s.draft_id::text,app.tenant_key,s.draft_revision,s.application_revision,
        app.config AS application_config,s.company_id::text,s.venue_id::text
        FROM admin_onboarding_scopes s
        JOIN admin_onboarding_drafts draft ON draft.id=s.draft_id
        JOIN admin_onboarding_app_configs app ON app.draft_id=s.draft_id
        JOIN companies company ON company.id=s.company_id
        JOIN venues venue ON venue.id=s.venue_id AND venue.company_id=s.company_id
        WHERE s.company_id=$1::bigint AND s.venue_id=$2::bigint
          AND company.active=TRUE AND venue.active=TRUE
          AND company.code<>'pivnik' AND venue.legacy_bar_id IS NULL
          AND s.status='prepared' AND s.revision=1
          AND s.draft_revision=draft.revision
          AND s.application_revision=app.revision
          AND app.isolation_policy='dedicated_database'`,
        [scope.companyId,scope.id])
      if(found.rows.length!==1)throw sourceMissing()
      const row=found.rows[0]!
      return createSpaceverseRuntimeManifest({
        draftId:row.draft_id,runtimeKey:row.tenant_key,
        draftRevision:Number(row.draft_revision),applicationRevision:Number(row.application_revision),
        scopeRevision:1,scope:{companyId:row.company_id,venueId:row.venue_id},
        config:onboardingAppConfig(row.application_config),
      })
    }finally{client.release()}
  }
  async function verifiedRead<T>(admin:AdminPrincipal,scope:VenueScope,
    read:(context:Parameters<typeof createSpaceverseCustomerWalletRepository>[0])=>Promise<T>,
    action:string,entityId:string){
    // Separate opt-in and absolute production denial until license/activation is implemented.
    if(!config.enableTenantCrmReads||!config.enableTenantCrmPilotReads||config.nodeEnv==='production')
      throw new HttpError(403,'TENANT_CRM_PILOT_READ_DISABLED',
        'Просмотр источника новой точки ещё не разрешён для этого окружения.')
    if(scope.companyCode==='pivnik'||scope.legacyBarId!==null)
      throw new HttpError(404,'VENUE_NOT_FOUND','Заведение не найдено или недоступно.')
    try{
      const first=await frozenSource(admin,scope)
      const target=await options.resolveTargetDatabase(first.runtimeKey)
      if(!target)throw sourceMissing()
      const client=await target.connect()
      try{
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        await client.query("SET LOCAL statement_timeout='5s'")
        const query=(text:string,params?:unknown[])=>client.query(text,params)
        const runtime=await resolveSpaceverseRuntime({query,environment:{
          SPACEVERSE_RUNTIME_MODE:'tenant',SPACEVERSE_RUNTIME_MANIFEST_JSON:JSON.stringify(first),
        }})
        const result=await read({query,runtime})
        // Both the source and the signed-in user's current venue grant are rechecked.
        const current=await frozenSource(admin,scope)
        if(first.manifestSha256!==current.manifestSha256)throw unavailable()
        const audit=await options.metadata.connect()
        try{
          await recordAudit({admin,scope,action,entityType:'tenant_crm_pilot',entityId,
            metadata:{purpose:'isolated_nonproduction_pilot_read'}},audit)
        }finally{audit.release()}
        await client.query('COMMIT')
        return {schemaVersion:1 as const,scope:first.scope,readStatus:'verified' as const,
          runtimeStatus:'not_provisioned' as const,...result}
      }catch(error){
        await client.query('ROLLBACK').catch(()=>undefined)
        throw error
      }finally{client.release()}
    }catch(error){
      if(error instanceof HttpError)throw error
      throw unavailable()
    }
  }
  return {
    listCustomers(admin:AdminPrincipal,scope:VenueScope,query:SpaceverseCustomerDirectoryQuery){
      return verifiedRead(admin,scope,context=>
        createSpaceverseCustomerDirectoryRepository(context)(query),
        'crm.pilot_customer_directory_read',scope.id)
    },
    readCustomer(admin:AdminPrincipal,scope:VenueScope,userId:string){
      if(!/^[1-9]\d{0,18}$/.test(userId)||BigInt(userId)>9223372036854775807n)
        throw new HttpError(400,'TENANT_CRM_ID_INVALID','Некорректный идентификатор клиента.')
      return verifiedRead(admin,scope,async context=>{
        const record=await createSpaceverseCustomerWalletRepository(context)({userId})
        if(!record)throw new HttpError(404,'TENANT_CRM_CUSTOMER_NOT_FOUND','Клиент не найден в этом заведении.')
        return record
      },'crm.pilot_customer_read',userId)
    },
  }
}
export const activeTenantCrmPilotReader=createActiveTenantCrmPilotReader({
  metadata:pool,resolveTargetDatabase:key=>onboardingTargetRegistry.resolveTargetDatabase(key),
})
