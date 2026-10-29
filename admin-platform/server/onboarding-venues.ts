import type {QueryResultRow} from 'pg'
import {pool} from './db.js'
import {listAuthorizedVenues} from './tenant.js'
import {getOnboardingWorkflow,requireWorkflow} from './onboarding-workflow.js'
import {onboardingDraftAccessSql} from './onboarding-access.js'
import {HttpError,type AdminPrincipal} from './types.js'
import {config} from './config.js'
import {readCrmActivationSummary} from './onboarding-provisioning-api.js'
import {unavailableCrmActivationSummary} from './tenant-crm-activation-state.js'

interface DraftRow extends QueryResultRow{
 id:string;venue_id:string|null;company_id:string|null;company_name:string;venue_name:string;updated_at:string
}
const severity:Record<string,number>={failed:5,degraded:4,suspended:3,verifying:2,pending:1,not_configured:0}
export async function listOnboardingVenues(admin:AdminPrincipal,rawOffset:string|null,rawQuery:string|null=null){
 await requireWorkflow(admin)
 if(rawOffset!==null&&!/^(0|[1-9][0-9]{0,5})$/.test(rawOffset))throw new HttpError(400,'ONBOARDING_VENUE_PAGE_INVALID','Откройте список заведений заново.')
 if(rawQuery!==null&&(rawQuery.length>100||Array.from(rawQuery).some(character=>{const code=character.codePointAt(0)!;return code<=31||code===127})))throw new HttpError(400,'ONBOARDING_VENUE_SEARCH_INVALID','Введите название заведения или организации — до 100 символов.')
 const query=rawQuery?.trim()??'',needle=query.normalize('NFC').toLocaleLowerCase('ru')
 const offset=Number(rawOffset??0),limit=25
 try{
  // Canonical venue resolver retains existing active-venue access. Draft access
  // adds prepared inactive scopes; neither name filtering nor UI chooses scope.
  const legacy=await listAuthorizedVenues(admin)
  const drafts=await pool.query<DraftRow>(`SELECT d.id::text,s.venue_id::text,
    COALESCE(s.company_id,d.company_id)::text AS company_id,
    COALESCE(c.name,d.data->>'companyName','') AS company_name,
    COALESCE(v.name,d.data->>'venueName','') AS venue_name,d.updated_at::text
    FROM admin_onboarding_drafts d LEFT JOIN admin_onboarding_scopes s ON s.draft_id=d.id
    LEFT JOIN companies c ON c.id=COALESCE(s.company_id,d.company_id)
    LEFT JOIN venues v ON v.id=s.venue_id AND v.company_id=s.company_id
    WHERE ${onboardingDraftAccessSql('d','$1')}`,[admin.id])
  const prepared=new Set(drafts.rows.map(row=>row.venue_id).filter(Boolean))
  const entries=[...drafts.rows.map(row=>({kind:'draft' as const,id:row.id,venueId:row.venue_id,
    companyId:row.company_id,companyName:row.company_name,name:row.venue_name,updatedAt:row.updated_at})),
   ...legacy.filter(venue=>!prepared.has(venue.id)).map(venue=>({kind:'existing' as const,id:venue.id,venueId:venue.id,
    companyId:venue.companyId,companyName:venue.companyName,name:venue.name,updatedAt:null}))]
   // Filter only authorized, deduplicated entries and before pagination. Search
   // is a literal substring: %, _ and SQL-like text never widen visibility.
   .filter(entry=>!needle||[entry.name,entry.companyName].some(value=>value.normalize('NFC').toLocaleLowerCase('ru').includes(needle)))
   .sort((a,b)=>a.companyName.localeCompare(b.companyName,'ru')||a.name.localeCompare(b.name,'ru')||a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id))
  const page=[]
  for(const entry of entries.slice(offset,offset+limit)){
   if(entry.kind==='existing'){
    page.push({...entry,status:'pending',requiresAttention:true,attentionCode:'connection_not_verified',
      nextAction:'Заведение создано раньше мастера. Статус связи ещё не подтверждён; откройте его показатели для проверки.',
      currentStep:null,lastOperatorActivityAt:null,lastDeviceActivityAt:null,runtimeStatus:'unknown',published:null,
      report:{state:'unavailable',netCents:null,receiptCount:null}})
    continue
   }
   try{
    const workflow=await getOnboardingWorkflow(admin,entry.id)
    let crmActivation:Awaited<ReturnType<typeof readCrmActivationSummary>>|ReturnType<typeof unavailableCrmActivationSummary>|undefined
    if(config.enableTenantCrmActivationChecks){
      if(!entry.venueId)crmActivation=unavailableCrmActivationSummary(entry.id,{companyId:entry.companyId,venueId:null},true)
      else try{
        crmActivation=await readCrmActivationSummary(admin,entry.id)
        if(crmActivation.scope.companyId!==entry.companyId||crmActivation.scope.venueId!==entry.venueId)throw new Error('CRM source changed')
      }catch(error){
        if(error instanceof HttpError&&[403,404].includes(error.statusCode))throw error
        crmActivation=unavailableCrmActivationSummary(entry.id,{companyId:entry.companyId,venueId:entry.venueId})
      }
    }
    const attention=workflow.steps.find(step=>['failed','degraded'].includes(step.status))
      ??workflow.steps.find(step=>step.id==='provisioning'&&step.status!=='active')
      ??workflow.steps.find(step=>step.status!=='active')
    // CRM is independent of optional guest bundle/image readiness. Keep current
    // cash failures visible alongside the explicitly historical CRM check.
    const cash=workflow.steps.find(step=>['provider','terminal','verification'].includes(step.id)&&
      ['failed','degraded','suspended'].includes(step.status))
    const primary=crmActivation&&(cash&&(severity[cash.status]??0)>(severity[crmActivation.status]??0)?cash:crmActivation)
    const lastActivity=crmActivation?.updatedAt&&Date.parse(crmActivation.updatedAt)>Date.parse(workflow.lastOperatorActivityAt)
      ?crmActivation.updatedAt:workflow.lastOperatorActivityAt
    page.push({...entry,draftId:entry.id,status:primary?.status??workflow.status,requiresAttention:workflow.requiresAttention,
      attentionCode:primary?.code??attention?.code??workflow.attentionCode,nextAction:primary?.nextAction??attention?.nextAction??'Продолжите подключение.',
      ...(crmActivation?{crmActivation}:{}),
      currentStep:workflow.progress.currentStep,lastOperatorActivityAt:lastActivity,
      lastDeviceActivityAt:workflow.lastDeviceActivityAt,runtimeStatus:workflow.runtimeStatus,published:workflow.published,report:workflow.report})
   }catch(error){
    // A grant revoked between listing and projection must not expose its draft.
    if(error instanceof HttpError&&[403,404].includes(error.statusCode))continue
    if(error instanceof HttpError){
     page.push({...entry,draftId:entry.id,status:error.statusCode<500||error.code==='ONBOARDING_SCOPE_INCONSISTENT'?'failed':'degraded',requiresAttention:true,
      attentionCode:'state_not_verified',nextAction:'Не удалось подтвердить состояние этой точки. Откройте мастер и повторите проверку; остальные заведения доступны.',
      currentStep:null,lastOperatorActivityAt:null,lastDeviceActivityAt:null,runtimeStatus:'unknown',published:null,
      report:{state:'unavailable',netCents:null,receiptCount:null}})
     continue
    }
    throw error
   }
  }
  return {venues:page,total:entries.length,offset,limit,nextOffset:offset+limit<entries.length?offset+limit:null,...(query?{q:query}:{})}
 }catch(error){if(error instanceof HttpError)throw error;throw new HttpError(503,'ONBOARDING_VENUES_UNAVAILABLE','Не удалось подтвердить состояния заведений. Обновите список; прежний статус не считается текущим.')}
}
