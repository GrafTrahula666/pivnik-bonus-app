import type { PoolClient,QueryResultRow } from 'pg'
import { pool } from './db.js'
import { config } from './config.js'
import { recordAudit } from './audit.js'
import { lockOnboardingDraftAccess,onboardingDraftAccessSql } from './onboarding-access.js'
import { providerAdvice,requireOnboardingAccess } from './venue-onboarding.js'
import { HttpError,type AdminPrincipal } from './types.js'

export const workflowSteps=['organization','venue','application','provider','terminal','modules','provisioning','verification'] as const
type Step=typeof workflowSteps[number]
type Status='not_configured'|'pending'|'verifying'|'active'|'degraded'|'suspended'|'failed'
interface Progress{currentStep:Step;terminal:{id:string;label:string};cashReports:boolean}
interface WorkflowRow extends QueryResultRow{
  id:string;draft_revision:number;data:{companyId:string|null;companyName:string;venueName:string}
  company_id:string|null;company_active:boolean|null;venue_id:string|null;venue_active:boolean|null
  app_revision:number|null;app_config:{loyaltyEnabled:boolean;shopEnabled:boolean}|null
  integration_status:string|null;integration_code:string|null;provider_checked_at:string|null
  provider_verified_at:string|null
  provisioning_status:string|null;provisioning_code:string|null;lease_active:boolean|null
  current_step:Step|null;terminal_id:string|null;terminal_label:string|null;cash_reports:boolean|null
  progress_revision:number|null;last_operator_activity_at:string
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const invalid=()=>new HttpError(400,'ONBOARDING_PROGRESS_INVALID','Проверьте шаг, терминал и настройки модулей. Статусы и ключи задаёт сервер.')
const unavailable=()=>new HttpError(503,'ONBOARDING_PROGRESS_UNAVAILABLE','Не удалось прочитать сохранённый прогресс. Повторите тот же запрос.')
const defaultProgress:Progress={currentStep:'organization',terminal:{id:'',label:''},cashReports:false}

export async function requireWorkflow(admin:AdminPrincipal,write=false){
  await requireOnboardingAccess(admin,write)
  if(!config.enableOnboardingWorkflow)throw new HttpError(403,'ONBOARDING_WORKFLOW_DISABLED','Шаги подключения пока выключены.')
  const ready=await pool.query<{ready:boolean}>("SELECT to_regclass('public.admin_onboarding_progress') IS NOT NULL AS ready")
  if(!ready.rows[0]?.ready)throw new HttpError(503,'ONBOARDING_PROGRESS_NOT_CONFIGURED','Для сохранения шагов нужна ручная миграция 012.')
}
function record(raw:unknown,keys:string[]):Record<string,unknown>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(key=>!keys.includes(key)))throw invalid()
  return raw as Record<string,unknown>
}
function text(raw:unknown,max:number){
  if(typeof raw!=='string'||raw.length>max
    ||Array.from(raw).some(character=>character.charCodeAt(0)<32||character.charCodeAt(0)===127))throw invalid()
  return raw.trim()
}
function command(raw:unknown){
  const body=record(raw,['revision','progress']),progress=record(body.progress,['currentStep','terminal','cashReports'])
  const terminal=record(progress.terminal,['id','label']),id=text(terminal.id,80),label=text(terminal.label,80)
  if(id&&(!/^[a-zA-Z0-9][a-zA-Z0-9._ -]*$/.test(id)||id.startsWith('pvpos_')))throw invalid()
  if(!workflowSteps.includes(progress.currentStep as Step)||typeof progress.cashReports!=='boolean'
    ||typeof body.revision!=='number'||!Number.isSafeInteger(body.revision)||body.revision<0||body.revision>=2147483647)throw invalid()
  return {revision:body.revision,progress:{currentStep:progress.currentStep as Step,terminal:{id,label},cashReports:progress.cashReports}}
}
function progress(row:WorkflowRow):Progress{
  return {currentStep:row.current_step??defaultProgress.currentStep,
    terminal:{id:row.terminal_id??'',label:row.terminal_label??''},cashReports:row.cash_reports??false}
}
async function load(client:Pick<PoolClient,'query'>,admin:AdminPrincipal,draftId:string,write=false){
  if(!uuid.test(draftId))throw invalid()
  const result=await client.query<WorkflowRow>(`SELECT d.id::text,d.revision AS draft_revision,d.data,
    COALESCE(s.company_id,d.company_id)::text AS company_id,c.active AS company_active,
    s.venue_id::text,v.active AS venue_active,a.revision AS app_revision,a.config AS app_config,
    integration.status AS integration_status,integration.last_error_code AS integration_code,
    integration.last_checked_at::text AS provider_checked_at,
    integration.verified_at::text AS provider_verified_at,
    provision.status AS provisioning_status,provision.last_error_code AS provisioning_code,
    (provision.lease_expires_at>NOW()) AS lease_active,
    p.current_step,p.terminal_id,p.terminal_label,p.cash_reports,p.revision AS progress_revision,
    GREATEST(d.updated_at,a.updated_at,s.updated_at,integration.updated_at,provision.updated_at,p.updated_at)::text AS last_operator_activity_at
    FROM admin_onboarding_drafts d
    LEFT JOIN admin_onboarding_scopes s ON s.draft_id=d.id
    LEFT JOIN companies c ON c.id=COALESCE(s.company_id,d.company_id)
    LEFT JOIN venues v ON v.id=s.venue_id AND v.company_id=s.company_id
    LEFT JOIN admin_onboarding_app_configs a ON a.draft_id=d.id
    LEFT JOIN admin_onboarding_integrations integration ON integration.draft_id=d.id AND integration.provider='evotor'
    LEFT JOIN admin_onboarding_provisioning_steps provision ON provision.draft_id=d.id AND provision.step='runtime_database_binding'
    LEFT JOIN admin_onboarding_progress p ON p.draft_id=d.id
    WHERE d.id=$1::uuid AND ${onboardingDraftAccessSql('d','$2',write)}`,[draftId,admin.id])
  if(!result.rows[0])throw new HttpError(404,'ONBOARDING_DRAFT_NOT_FOUND','Черновик не найден или недоступен.')
  return result.rows[0]
}
function view(row:WorkflowRow){
  const saved=progress(row),scope=Boolean(row.venue_id),steps:{id:Step;status:Status;code:string;nextAction:string}[]=[]
  const add=(id:Step,status:Status,code:string,nextAction:string)=>steps.push({id,status,code,nextAction})
  add('organization',row.company_active===true?'active':'pending',row.company_active===true?'organization_exists':'organization_pending',
    row.company_active===true?'Организация выбрана.':'Организация сохранена. Её включение требует подтверждённого развёртывания.')
  add('venue',scope?'pending':'not_configured',scope?'venue_reserved':'venue_not_reserved',
    scope?'Точка подготовлена и выключена.':'Сохраните данные и приложение, затем подготовьте область.')
  add('application',row.app_revision?'pending':'not_configured',row.app_revision?'application_saved':'application_missing',
    row.app_revision?'Настройки сохранены. Приложение ещё не развёрнуто.':'Сохраните настройки приложения.')
  const stale=row.integration_status==='verified'&&(!row.provider_checked_at||Date.now()-Date.parse(row.provider_checked_at)>15*60_000)
  const rejected=['error','action_required'].includes(row.integration_status??'')
  const provider:Status=stale?'degraded':row.integration_status==='verified'?'active':
    rejected?(row.provider_verified_at?'degraded':'failed'):row.integration_status?'pending':'not_configured'
  add('provider',provider,stale?'provider_check_stale':row.integration_code??(row.integration_status==='verified'?'documents_readable':row.integration_status?'provider_not_verified':'provider_missing'),
    stale?'Последняя проверка была более 15 минут назад. Повторите проверку доступа.':
    row.integration_status==='verified'?'Чтение документов подтверждено. Связь терминала проверяется отдельно.':
    rejected?(providerAdvice[row.integration_code??'']??'Провайдер не подтвердил доступ. Откройте кассу и повторите проверку.'):'Настройте кассу или провайдера и проверьте доступ.')
  add('terminal',saved.terminal.id?'pending':'not_configured',saved.terminal.id?'terminal_saved_unbound':'terminal_missing',
    saved.terminal.id?'ID сохранён. Привязка устройства и тестовое событие ещё не подтверждены.':'Укажите ID терминала. Ключ устройства вводится в защищённом шаге связи.')
  const modulesSaved=Boolean(row.progress_revision&&row.app_revision)
  const modulesDisabled=modulesSaved&&!saved.cashReports&&!row.app_config?.loyaltyEnabled&&!row.app_config?.shopEnabled
  add('modules',modulesDisabled?'suspended':modulesSaved?'pending':'not_configured',modulesDisabled?'modules_disabled':modulesSaved?'modules_saved':'modules_missing',
    modulesDisabled?'Модули выключены в сохранённых настройках.':modulesSaved?'Выбор модулей сохранён. Они включатся после готовности приложения.':'Сохраните выбор модулей.')
  const provisioning:Status=row.provisioning_status==='running'?(row.lease_active?'verifying':'degraded'):
    row.provisioning_status==='retryable_error'?'failed':'pending'
  add('provisioning',provisioning,row.provisioning_code??(row.provisioning_status==='succeeded'?'binding_ready_runtime_pending':'runtime_not_provisioned'),
    row.provisioning_status==='succeeded'?'Привязка БД подтверждена. Это не запуск приложения.':'Развёртывание не подтверждено. Требуется разрешённый серверный запуск; здесь успех не симулируется.')
  add('verification',scope?'pending':'not_configured','terminal_event_not_verified','После развёртывания отправьте тестовое событие с кассы и проверьте ответ провайдера. Чтение документов само по себе не подтверждает терминал.')
  const inconsistent=row.venue_active===true
  return {draftId:row.id,revision:row.progress_revision??0,progress:saved,steps,
    status:inconsistent||steps.some(step=>step.status==='failed')?'failed':steps.some(step=>step.status==='degraded')?'degraded':steps.some(step=>step.status==='verifying')?'verifying':'pending',requiresAttention:true,
    attentionCode:inconsistent?'scope_changed':'runtime_not_provisioned',runtimeStatus:'not_provisioned',published:false,
    modules:{loyalty:row.app_config?.loyaltyEnabled??false,shop:row.app_config?.shopEnabled??false,cashReports:saved.cashReports},
    lastOperatorActivityAt:row.last_operator_activity_at,lastDeviceActivityAt:null,
    report:{state:'unavailable',netCents:null,receiptCount:null,code:'no_verified_connection'},
  }
}
export async function getOnboardingWorkflow(admin:AdminPrincipal,draftId:string){
  await requireWorkflow(admin)
  try{return view(await load(pool,admin,draftId))}catch(error){if(error instanceof HttpError)throw error;throw unavailable()}
}
export async function saveOnboardingWorkflow(admin:AdminPrincipal,draftId:string,raw:unknown){
  await requireWorkflow(admin,true)
  if(!uuid.test(draftId))throw invalid()
  const input=command(raw),client=await pool.connect().catch(()=>{throw unavailable()})
  try{
    await client.query('BEGIN')
    await lockOnboardingDraftAccess(client,admin,draftId)
    await client.query('SELECT id FROM admin_onboarding_drafts WHERE id=$1::uuid FOR UPDATE',[draftId])
    const before=await load(client,admin,draftId,true),revision=before.progress_revision??0
    if(revision!==input.revision){
      if(revision===input.revision+1&&JSON.stringify(progress(before))===JSON.stringify(input.progress)){
        await client.query('COMMIT');return view(before)
      }
      throw new HttpError(409,'ONBOARDING_PROGRESS_CONFLICT','Прогресс изменился. Откройте последнюю сохранённую версию.')
    }
    await client.query(`INSERT INTO admin_onboarding_progress(draft_id,current_step,terminal_id,terminal_label,cash_reports)
      VALUES($1::uuid,$2,$3,$4,$5) ON CONFLICT(draft_id) DO UPDATE SET
      current_step=EXCLUDED.current_step,terminal_id=EXCLUDED.terminal_id,terminal_label=EXCLUDED.terminal_label,
      cash_reports=EXCLUDED.cash_reports,revision=admin_onboarding_progress.revision+1,updated_at=NOW()`,
    [draftId,input.progress.currentStep,input.progress.terminal.id,input.progress.terminal.label,input.progress.cashReports])
    await recordAudit({admin,action:'onboarding.progress_save',entityType:'onboarding_draft',entityId:draftId,
      before:{revision},after:{revision:revision+1},metadata:{currentStep:input.progress.currentStep}},client)
    const saved=await load(client,admin,draftId,true)
    await client.query('COMMIT');return view(saved)
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);if(error instanceof HttpError)throw error;throw unavailable()}finally{client.release()}
}
