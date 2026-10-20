import type { IncomingMessage, ServerResponse } from 'node:http'
import { changePassword, login, loadSession, logout, requireCsrf } from './auth.js'
import { pool, readPool } from './db.js'
import { config } from './config.js'
import {
  getAchievementAnalytics,
  getCapabilities,
  getClientDetail,
  getClients,getClientSegments,
  getLegacyDesign,
  getOperations,
  getPromotions,
  getShop,
  getVenueDashboard,
  getWheelAnalytics,
  parsePeriod,
} from './data.js'
import { recordAudit } from './audit.js'
import { getAdminAudit, getAdminPlatformSummary } from './admin-metadata-read.js'
import { enforceOrigin, enforceRateLimit, readJsonBody, requestIp, securityHeaders } from './security.js'
import {
  listAuthorizedVenues,
  requireVenueAccess,
  requireSuperAdmin,
  resolveVenueScope,
} from './tenant.js'
import { adjustPivnikBonusPilot } from './bonus-pilot-writer.js'
import { getAppLoyalty,saveAppLoyalty } from './pivnik-app-loyalty.js'
import { getAppWheel,saveAppWheel } from './pivnik-app-wheel.js'
import { getAppRewards,getGuestRewards,grantGuestAchievement,grantGuestFrame,revokeGuestFrame,saveAppAchievements } from './pivnik-app-rewards.js'
import {
  getManagedBranding,
  getManagedFeatures,
  getManagedLoyalty,
  getManagedPromotions,
  getManagedShop,
  grantCustomerEntitlement,
  manualGrantAchievement,
  saveAchievements,
  saveBranding,
  saveFeatureSettings,
  saveLoyalty,
  savePromotions,
  saveShop,
  saveWheel,
  setCustomerCashbackOverride,
} from './writes.js'
import {
  getPivnikManagedAchievementsRead,
  getPivnikManagedWheelRead,
} from './pivnik-legacy-manager-read.js'
import { HttpError } from './types.js'
import { evotorPeriod,getEvotorReport } from './evotor-read.js'
import {
  PROMOTION_BODY_LIMIT,createAppPromotion,deleteAppPromotion,getAppDesign,listAppPromotions,publishAppDesign,updateAppPromotion,
} from './pivnik-app-content.js'
import { getBroadcastPreview,listBroadcasts,sendBroadcast } from './pivnik-broadcast.js'
import { getDeveloperOverview,rememberServerError } from './developer.js'
import { canManageOnboardingInvitations,canUseOnboarding } from './onboarding-access.js'
import { getOnboardingWorkflow,saveOnboardingWorkflow } from './onboarding-workflow.js'
import {onboardingSupport,onboardingSupportQueue} from './onboarding-support.js'
import { listOnboardingVenues } from './onboarding-venues.js'
import { readTenantCrmCustomer, listTenantCrmCustomers, checkTenantCrmReadiness } from './tenant-crm-read.js'
import { getOnboardingPosProxy,saveOnboardingPosProxy,verifyOnboardingPosProxy } from './onboarding-pos-proxy.js'
import { acceptOnboardingInvitation,createOnboardingInvitation,listOnboardingInvitations,previewOnboardingInvitation,reopenOnboardingInvitation,revokeOnboardingInvitation } from './onboarding-invitations.js'
import {
  claimOnboardingInvite,createOnboardingDraft,createOnboardingInvite,getOnboardingAppConfig,getOnboardingDraft,getOnboardingIndex,
  getOnboardingEvotorIntegration,getOnboardingInvitePreview,getOnboardingInvites,getOnboardingRequest,getOnboardingScope,
  prepareOnboardingScope,prepareCrmOnboardingScope,requireOnboardingAccess,requireOnboardingIntegrationAccess,revokeOnboardingInvite,
  saveOnboardingAppConfig,saveOnboardingEvotorIntegration,updateOnboardingDraft,verifyOnboardingEvotorIntegration,
} from './venue-onboarding.js'
import {
  getOnboardingRuntimeBundleVerification,getOnboardingRuntimeDatabaseBinding,getOnboardingTenantSchemaReadiness,
  runOnboardingRuntimeBundleVerification,runOnboardingRuntimeDatabaseBinding,runOnboardingTenantSchemaReadiness,
  getCrmActivationCheck,runCrmActivationCheck,
} from './onboarding-provisioning-api.js'

function json(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload))
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', String(body.length))
  securityHeaders(res)
  res.end(body)
}
const routeParts=(pathname:string)=>pathname.split('/').filter(Boolean)
const isMethod=(req:IncomingMessage,method:string)=>String(req.method||'GET').toUpperCase()===method
export const sessionCapabilities=()=>({
  writes:config.enableWrites,
  // The production writers also refuse while ADMIN_ENABLE_WRITES is off, so the UI must not offer them then.
  productionBonusWrites:config.enableWrites&&config.enableProductionBonusWrites,
  productionAchievementWrites:config.enableWrites&&config.enableProductionAchievementWrites,
  productionEntitlementWrites:config.enableWrites&&config.enableProductionEntitlementWrites,
  demo:config.demoEnabled,
  onboardingDrafts:config.enableWrites&&config.enableOnboardingDrafts,
  onboardingIntegrations:config.enableWrites&&config.enableOnboardingDrafts&&config.enableOnboardingIntegrations,
  onboardingInvitations:config.enableWrites&&config.enableOnboardingDrafts&&config.enableOnboardingInvitations,
  onboardingProvisioning:config.enableWrites&&config.enableOnboardingDrafts&&config.enableOnboardingProvisioning,
  onboardingSupport:config.enableWrites&&config.enableOnboardingDrafts&&config.enableOnboardingSupport,
  onboardingWorkflow:config.enableWrites&&config.enableOnboardingDrafts&&config.enableOnboardingWorkflow,
  onboardingPosProxy:config.enableWrites&&config.enableOnboardingDrafts&&config.enableOnboardingWorkflow&&config.enableOnboardingPosProxy,
  tenantCrmReads:config.enableWrites&&config.enableOnboardingDrafts&&config.enableTenantCrmReads,
  tenantCrmActivationChecks:config.enableWrites&&config.enableOnboardingDrafts&&config.enableTenantCrmActivationChecks,
  crmOnboarding:config.enableWrites&&config.enableOnboardingDrafts&&config.enableCrmOnboarding,
})
async function capabilitiesFor(admin:import('./types.js').AdminPrincipal){
  const capabilities=sessionCapabilities()
  if(!capabilities.onboardingInvitations)return capabilities
  return {...capabilities,onboardingAccess:await canUseOnboarding(admin),onboardingWrite:await canUseOnboarding(admin,true),
    onboardingInvitationOwner:await canManageOnboardingInvitations(admin)}
}

export async function handleApi(req:IncomingMessage,res:ServerResponse,url:URL):Promise<boolean>{
  if(!url.pathname.startsWith('/api/admin/')) return false
  enforceOrigin(req)

  if(isMethod(req,'GET')&&url.pathname==='/api/admin/health'){
    try{
      const [db,,schema]=await Promise.all([
        pool.query<{now:string}>('SELECT NOW()::text AS now'),
        readPool.query<{default_transaction_read_only:string}>('SHOW default_transaction_read_only'),
        pool.query<{exists:boolean}>(`SELECT to_regclass('public.admin_accounts') IS NOT NULL AS exists`),
      ])
      const healthy=Boolean(schema.rows[0]?.exists)
      json(res,healthy?200:503,{
        ok:healthy,
        time:db.rows[0]?.now,
      })
    }catch{
      json(res,503,{ok:false,database:'unavailable'})
    }
    return true
  }

  if(isMethod(req,'POST')&&url.pathname==='/api/admin/auth/login'){
    const body=await readJsonBody<{email?:string;password?:string}>(req)
    const result=await login(req,res,body.email,body.password)
    await recordAudit({admin:result.admin,action:'auth.login',entityType:'admin_session',metadata:{ipHashOnly:true}}).catch(()=>undefined)
    json(res,200,{...result,capabilities:await capabilitiesFor(result.admin)});return true
  }

  // Public (unauthenticated) one-time invite redemption — no session exists yet to load.
  const onboardingInvitePreview=/^\/api\/admin\/onboarding\/invite\/([^/]+)$/.exec(url.pathname)
  if(isMethod(req,'GET')&&onboardingInvitePreview){
    json(res,200,await getOnboardingInvitePreview(req,onboardingInvitePreview[1]));return true
  }
  if(isMethod(req,'POST')&&url.pathname==='/api/admin/onboarding/invite/claim'){
    const result=await claimOnboardingInvite(req,res,await readJsonBody(req,4*1024))
    json(res,200,{...result,capabilities:sessionCapabilities()});return true
  }

  if(isMethod(req,'GET')&&url.pathname==='/api/admin/auth/session'){
    try{
      const session=await loadSession(req)
      json(res,200,{admin:session.admin,csrfToken:session.csrfToken,capabilities:await capabilitiesFor(session.admin)})
    }catch(error){
      if(error instanceof HttpError&&error.statusCode===401)json(res,200,{authenticated:false,demo:config.demoEnabled,
        invitations:config.enableWrites&&config.enableOnboardingDrafts&&config.enableOnboardingInvitations})
      else throw error
    }
    return true
  }

  if(isMethod(req,'POST')&&url.pathname==='/api/admin/onboarding/invitations/preview'){
    enforceRateLimit(`invitation-preview:${requestIp(req)}`,30,60_000)
    json(res,200,await previewOnboardingInvitation(await readJsonBody(req,1024)));return true
  }
  if(isMethod(req,'POST')&&url.pathname==='/api/admin/onboarding/invitations/accept'){
    enforceRateLimit(`invitation-accept:${requestIp(req)}`,10,60_000)
    let existing:Awaited<ReturnType<typeof loadSession>>|null=null
    try{existing=await loadSession(req)}catch(error){if(!(error instanceof HttpError&&error.statusCode===401))throw error}
    if(existing)requireCsrf(req,existing.rawToken)
    const body=await readJsonBody<{token?:unknown;email?:unknown;displayName?:unknown;password?:unknown}>(req,4*1024)
    const accepted=await acceptOnboardingInvitation(existing?.admin||null,body)
    if(!existing){
      // New-account password was chosen by this recipient; never reset an existing account.
      const authenticated=await login(req,res,accepted.admin.email,body.password)
      json(res,200,{...accepted,...authenticated,capabilities:await capabilitiesFor(authenticated.admin)});return true
    }
    json(res,200,{...accepted,csrfToken:existing.csrfToken,capabilities:await capabilitiesFor(existing.admin)});return true
  }
  const session=await loadSession(req)
  const invitation=/^\/api\/admin\/onboarding\/invitations(?:\/([^/]+)\/(revoke|link))?$/.exec(url.pathname)
  if(invitation){
    if(isMethod(req,'GET')&&!invitation[1]){json(res,200,await listOnboardingInvitations(session.admin));return true}
    requireCsrf(req,session.rawToken)
    enforceRateLimit(`invitation-owner:${session.admin.id}`,30,60_000)
    if(isMethod(req,'POST')){
      json(res,200,invitation[1]?invitation[2]==='link'?await reopenOnboardingInvitation(session.admin,invitation[1]):await revokeOnboardingInvitation(session.admin,invitation[1]):await createOnboardingInvitation(session.admin,await readJsonBody(req,2048)));return true
    }
    throw new HttpError(405,'METHOD_NOT_ALLOWED','Этот метод не поддерживается.')
  }
  if(isMethod(req,'POST')&&url.pathname==='/api/admin/auth/logout'){
    requireCsrf(req,session.rawToken)
    await recordAudit({admin:session.admin,action:'auth.logout',entityType:'admin_session',metadata:{ipPresent:Boolean(requestIp(req))}}).catch(()=>undefined)
    await logout(req,res);json(res,200,{ok:true});return true
  }
  if(isMethod(req,'POST')&&url.pathname==='/api/admin/auth/password'){
    requireCsrf(req,session.rawToken)
    const body=await readJsonBody<{currentPassword?:string;newPassword?:string}>(req)
    const result=await changePassword(session.admin,session.rawToken,body.currentPassword,body.newPassword)
    await recordAudit({
      admin:session.admin,
      action:'auth.password_change',
      entityType:'admin_account',
      entityId:session.admin.id,
      metadata:{revokedSessions:result.revokedSessions,passwordNeverLogged:true},
    }).catch(()=>undefined)
    json(res,200,result);return true
  }
  const crmPreparation=/^\/api\/admin\/onboarding\/drafts\/([^/]+)\/crm\/prepare$/.exec(url.pathname)
  if(crmPreparation){
    if(!isMethod(req,'POST'))throw new HttpError(405,'METHOD_NOT_ALLOWED','Подготовка CRM выполняется отдельной командой.')
    if(url.search)throw new HttpError(400,'ONBOARDING_SCOPE_COMMAND_INVALID','Настройки и область CRM определяются сервером.')
    requireCsrf(req,session.rawToken)
    enforceRateLimit(`crm-preparation:${session.admin.id}`,20,60_000)
    json(res,200,await prepareCrmOnboardingScope(session.admin,crmPreparation[1]!,await readJsonBody(req,256)));return true
  }
  if(url.pathname==='/api/admin/onboarding/support'){
    if(!isMethod(req,'GET'))throw new HttpError(405,'METHOD_NOT_ALLOWED','Доступно чтение очереди.')
    if([...url.searchParams.keys()].some(key=>key!=='offset')||url.searchParams.getAll('offset').length>1||
      !/^(0|[1-9]\d{0,5})$/.test(url.searchParams.get('offset')??'0'))throw new HttpError(400,'ONBOARDING_SUPPORT_INVALID','Проверьте страницу очереди.')
    enforceRateLimit(`onboarding-support-queue:${session.admin.id}`,30,60_000)
    json(res,200,await onboardingSupportQueue(session.admin,Number(url.searchParams.get('offset')??0)));return true
  }
  const support=/^\/api\/admin\/onboarding\/drafts\/([^/]+)\/support$/.exec(url.pathname)
  if(support){
    if(!isMethod(req,'GET')&&!isMethod(req,'POST'))throw new HttpError(405,'METHOD_NOT_ALLOWED','Доступны создание и чтение обращений.')
    if(url.search)throw new HttpError(400,'ONBOARDING_SUPPORT_INVALID','Область обращения определяется сервером.')
    if(isMethod(req,'POST'))requireCsrf(req,session.rawToken)
    enforceRateLimit(`onboarding-support:${session.admin.id}`,30,60_000)
    json(res,200,await onboardingSupport(session.admin,support[1]!,isMethod(req,'POST')?await readJsonBody(req,1024):undefined));return true
  }
  if(url.pathname==='/api/admin/onboarding/venues'){
    if(!isMethod(req,'GET'))throw new HttpError(405,'METHOD_NOT_ALLOWED','Этот метод не поддерживается.')
    if([...url.searchParams.keys()].some(key=>!['offset','q'].includes(key))||['offset','q'].some(key=>url.searchParams.getAll(key).length>1))throw new HttpError(400,'ONBOARDING_VENUE_PAGE_INVALID','Область списка определяется вашей учётной записью.')
    enforceRateLimit(`onboarding-venues:${session.admin.id}`,60,60_000)
    json(res,200,await listOnboardingVenues(session.admin,url.searchParams.get('offset'),url.searchParams.get('q')));return true
  }
  const crmActivationCheck=/^\/api\/admin\/onboarding\/drafts\/([^/]+)\/crm\/activation-check$/.exec(url.pathname)
  if(crmActivationCheck){
    if(!isMethod(req,'GET')&&!isMethod(req,'POST'))throw new HttpError(405,'METHOD_NOT_ALLOWED','Доступны чтение состояния и запуск проверки CRM.')
    if(url.search)throw new HttpError(400,'TENANT_CRM_REQUEST_SCOPE_FORBIDDEN','Область и статусы проверки определяются сервером.')
    if(isMethod(req,'POST'))requireCsrf(req,session.rawToken)
    enforceRateLimit(`crm-activation-check:${session.admin.id}`,20,60_000)
    const result=isMethod(req,'GET')?await getCrmActivationCheck(session.admin,crmActivationCheck[1]!):
      await runCrmActivationCheck(session.admin,crmActivationCheck[1]!,await readJsonBody(req))
    json(res,200,result);return true
  }
  const tenantCrmReadiness=/^\/api\/admin\/onboarding\/drafts\/([^/]+)\/crm\/readiness$/.exec(url.pathname)
  if(tenantCrmReadiness){
    if(!isMethod(req,'GET'))throw new HttpError(405,'METHOD_NOT_ALLOWED','Доступна только проверка готовности CRM.')
    if(url.search)throw new HttpError(400,'TENANT_CRM_REQUEST_SCOPE_FORBIDDEN','Область и статусы проверки определяются сервером.')
    enforceRateLimit(`tenant-crm-read:${session.admin.id}`,30,60_000)
    json(res,200,await checkTenantCrmReadiness(session.admin,tenantCrmReadiness[1]!));return true
  }
  const tenantCustomer=/^\/api\/admin\/onboarding\/drafts\/([^/]+)\/crm\/customers(?:\/([^/]+))?$/.exec(url.pathname)
  if(tenantCustomer){
    if(!isMethod(req,'GET'))throw new HttpError(405,'METHOD_NOT_ALLOWED','Доступно только чтение клиента.')
    enforceRateLimit(`tenant-crm-read:${session.admin.id}`,30,60_000)
    if(tenantCustomer[2]){
      if(url.search)throw new HttpError(400,'TENANT_CRM_REQUEST_SCOPE_FORBIDDEN','Область и источник клиента определяются сервером; параметры запроса не принимаются.')
      json(res,200,await readTenantCrmCustomer(session.admin,tenantCustomer[1]!,tenantCustomer[2]));return true
    }
    if([...url.searchParams.keys()].some(key=>!['q','limit','offset'].includes(key)||url.searchParams.getAll(key).length!==1))
      throw new HttpError(400,'TENANT_CRM_REQUEST_SCOPE_FORBIDDEN','Область и источник клиентов определяются сервером.')
    const integer=(name:string,fallback:number)=>{
      const raw=url.searchParams.get(name)
      if(raw===null)return fallback
      if(!/^(0|[1-9]\d{0,6})$/.test(raw))throw new HttpError(400,'TENANT_CRM_PAGE_INVALID','Некорректный размер или номер страницы.')
      return Number(raw)
    }
    json(res,200,await listTenantCrmCustomers(session.admin,tenantCustomer[1]!,{
      q:url.searchParams.get('q')??'',limit:integer('limit',25),offset:integer('offset',0),
    }));return true
  }
  const posProxy=/^\/api\/admin\/onboarding\/drafts\/([^/]+)\/integrations\/pos-proxy(?:\/(verify))?$/.exec(url.pathname)
  if(posProxy){
    if(isMethod(req,'GET')&&!posProxy[2]){json(res,200,await getOnboardingPosProxy(session.admin,posProxy[1]!));return true}
    if((isMethod(req,'PUT')&&!posProxy[2])||(isMethod(req,'POST')&&posProxy[2])){
      requireCsrf(req,session.rawToken);enforceRateLimit(`onboarding-pos-proxy:${session.admin.id}`,20,60_000)
      const body=await readJsonBody(req,2048)
      json(res,200,posProxy[2]?await verifyOnboardingPosProxy(session.admin,posProxy[1]!,body):await saveOnboardingPosProxy(session.admin,posProxy[1]!,body));return true
    }
    throw new HttpError(405,'METHOD_NOT_ALLOWED','Этот метод не поддерживается.')
  }
  const workflow=/^\/api\/admin\/onboarding\/drafts\/([^/]+)\/progress$/.exec(url.pathname)
  if(workflow){
    if(isMethod(req,'GET')){json(res,200,await getOnboardingWorkflow(session.admin,workflow[1]!));return true}
    if(isMethod(req,'PUT')){
      requireCsrf(req,session.rawToken);enforceRateLimit(`onboarding-progress:${session.admin.id}`,60,60_000)
      json(res,200,await saveOnboardingWorkflow(session.admin,workflow[1]!,await readJsonBody(req,2048)));return true
    }
    throw new HttpError(405,'METHOD_NOT_ALLOWED','Этот метод не поддерживается.')
  }
  const onboardingApp=/^\/api\/admin\/onboarding\/drafts\/([^/]+)\/application$/.exec(url.pathname)
  if(onboardingApp){
    await requireOnboardingAccess(session.admin,!isMethod(req,'GET'))
    if(!isMethod(req,'GET')){
      requireCsrf(req,session.rawToken)
      enforceRateLimit(`onboarding-application:${session.admin.id}`,60,60_000)
    }
    if(isMethod(req,'GET')){json(res,200,await getOnboardingAppConfig(session.admin,onboardingApp[1]!));return true}
    if(isMethod(req,'PUT')){
      json(res,200,await saveOnboardingAppConfig(session.admin,onboardingApp[1]!,await readJsonBody(req,4*1024)));return true
    }
    throw new HttpError(405,'METHOD_NOT_ALLOWED','Этот метод не поддерживается.')
  }
  const onboardingScope=/^\/api\/admin\/onboarding\/drafts\/([^/]+)\/scope$/.exec(url.pathname)
  if(onboardingScope){
    await requireOnboardingAccess(session.admin,!isMethod(req,'GET'))
    if(!isMethod(req,'GET')){
      requireCsrf(req,session.rawToken)
      enforceRateLimit(`onboarding-scope:${session.admin.id}`,60,60_000)
    }
    if(isMethod(req,'GET')){json(res,200,await getOnboardingScope(session.admin,onboardingScope[1]!));return true}
    if(isMethod(req,'PUT')){
      json(res,200,await prepareOnboardingScope(session.admin,onboardingScope[1]!,await readJsonBody(req,1024)));return true
    }
    throw new HttpError(405,'METHOD_NOT_ALLOWED','Этот метод не поддерживается.')
  }
  const onboardingProvisioningRun=/^\/api\/admin\/onboarding\/drafts\/([^/]+)\/provisioning\/runtime-database-binding\/run$/.exec(url.pathname)
  if(onboardingProvisioningRun){
    requireCsrf(req,session.rawToken)
    enforceRateLimit(`onboarding-provisioning:${session.admin.id}`,20,60_000)
    if(url.searchParams.size)throw new HttpError(400,'ONBOARDING_PROVISIONING_COMMAND_INVALID','Параметры подключения в URL не принимаются.')
    if(isMethod(req,'POST')){
      json(res,200,await runOnboardingRuntimeDatabaseBinding(session.admin,onboardingProvisioningRun[1]!,await readJsonBody(req,256)));return true
    }
    throw new HttpError(405,'METHOD_NOT_ALLOWED','Этот метод не поддерживается.')
  }
  const onboardingProvisioning=/^\/api\/admin\/onboarding\/drafts\/([^/]+)\/provisioning\/runtime-database-binding$/.exec(url.pathname)
  if(onboardingProvisioning){
    if(url.searchParams.size)throw new HttpError(400,'ONBOARDING_PROVISIONING_COMMAND_INVALID','Параметры подключения в URL не принимаются.')
    if(isMethod(req,'GET')){
      json(res,200,await getOnboardingRuntimeDatabaseBinding(session.admin,onboardingProvisioning[1]!));return true
    }
    throw new HttpError(405,'METHOD_NOT_ALLOWED','Этот метод не поддерживается.')
  }
  const onboardingSchemaReadinessRun=/^\/api\/admin\/onboarding\/drafts\/([^/]+)\/provisioning\/tenant-schema-readiness\/run$/.exec(url.pathname)
  if(onboardingSchemaReadinessRun){
    requireCsrf(req,session.rawToken)
    enforceRateLimit(`onboarding-provisioning:${session.admin.id}`,20,60_000)
    if(url.searchParams.size)throw new HttpError(400,'ONBOARDING_PROVISIONING_COMMAND_INVALID','Параметры подключения в URL не принимаются.')
    if(isMethod(req,'POST')){
      json(res,200,await runOnboardingTenantSchemaReadiness(session.admin,onboardingSchemaReadinessRun[1]!,await readJsonBody(req,256)));return true
    }
    throw new HttpError(405,'METHOD_NOT_ALLOWED','Этот метод не поддерживается.')
  }
  const onboardingSchemaReadiness=/^\/api\/admin\/onboarding\/drafts\/([^/]+)\/provisioning\/tenant-schema-readiness$/.exec(url.pathname)
  if(onboardingSchemaReadiness){
    if(url.searchParams.size)throw new HttpError(400,'ONBOARDING_PROVISIONING_COMMAND_INVALID','Параметры подключения в URL не принимаются.')
    if(isMethod(req,'GET')){
      json(res,200,await getOnboardingTenantSchemaReadiness(session.admin,onboardingSchemaReadiness[1]!));return true
    }
    throw new HttpError(405,'METHOD_NOT_ALLOWED','Этот метод не поддерживается.')
  }
  const onboardingRuntimeBundleRun=/^\/api\/admin\/onboarding\/drafts\/([^/]+)\/provisioning\/runtime-bundle\/run$/.exec(url.pathname)
  if(onboardingRuntimeBundleRun){
    requireCsrf(req,session.rawToken)
    enforceRateLimit(`onboarding-provisioning:${session.admin.id}`,20,60_000)
    if(url.searchParams.size)throw new HttpError(400,'ONBOARDING_PROVISIONING_COMMAND_INVALID','Параметры bundle в URL не принимаются.')
    if(isMethod(req,'POST')){
      json(res,200,await runOnboardingRuntimeBundleVerification(session.admin,onboardingRuntimeBundleRun[1]!,await readJsonBody(req,256)));return true
    }
    throw new HttpError(405,'METHOD_NOT_ALLOWED','Этот метод не поддерживается.')
  }
  const onboardingRuntimeBundle=/^\/api\/admin\/onboarding\/drafts\/([^/]+)\/provisioning\/runtime-bundle$/.exec(url.pathname)
  if(onboardingRuntimeBundle){
    if(url.searchParams.size)throw new HttpError(400,'ONBOARDING_PROVISIONING_COMMAND_INVALID','Параметры bundle в URL не принимаются.')
    if(isMethod(req,'GET')){
      json(res,200,await getOnboardingRuntimeBundleVerification(session.admin,onboardingRuntimeBundle[1]!));return true
    }
    throw new HttpError(405,'METHOD_NOT_ALLOWED','Этот метод не поддерживается.')
  }
  const onboardingEvotorVerify=/^\/api\/admin\/onboarding\/drafts\/([^/]+)\/integrations\/evotor\/verify$/.exec(url.pathname)
  if(onboardingEvotorVerify){
    await requireOnboardingIntegrationAccess(session.admin,!isMethod(req,'GET'))
    requireCsrf(req,session.rawToken)
    enforceRateLimit(`onboarding-evotor-verify:${session.admin.id}`,20,60_000)
    if(isMethod(req,'POST')){
      json(res,200,await verifyOnboardingEvotorIntegration(session.admin,onboardingEvotorVerify[1]!,await readJsonBody(req,1024)));return true
    }
    throw new HttpError(405,'METHOD_NOT_ALLOWED','Этот метод не поддерживается.')
  }
  const onboardingEvotor=/^\/api\/admin\/onboarding\/drafts\/([^/]+)\/integrations\/evotor$/.exec(url.pathname)
  if(onboardingEvotor){
    await requireOnboardingIntegrationAccess(session.admin,!isMethod(req,'GET'))
    if(!isMethod(req,'GET')){
      requireCsrf(req,session.rawToken)
      enforceRateLimit(`onboarding-evotor:${session.admin.id}`,30,60_000)
    }
    if(isMethod(req,'GET')){json(res,200,await getOnboardingEvotorIntegration(session.admin,onboardingEvotor[1]!));return true}
    if(isMethod(req,'PUT')){
      json(res,200,await saveOnboardingEvotorIntegration(session.admin,onboardingEvotor[1]!,await readJsonBody(req,8*1024)));return true
    }
    throw new HttpError(405,'METHOD_NOT_ALLOWED','Этот метод не поддерживается.')
  }
  const onboardingInvite=/^\/api\/admin\/onboarding\/drafts\/([^/]+)\/invites\/([^/]+)$/.exec(url.pathname)
  if(onboardingInvite){
    await requireOnboardingAccess(session.admin,!isMethod(req,'GET'))
    requireCsrf(req,session.rawToken)
    enforceRateLimit(`onboarding-invite:${session.admin.id}`,60,60_000)
    if(isMethod(req,'DELETE')){json(res,200,await revokeOnboardingInvite(session.admin,onboardingInvite[1]!,onboardingInvite[2]!));return true}
    throw new HttpError(405,'METHOD_NOT_ALLOWED','Этот метод не поддерживается.')
  }
  const onboardingInvites=/^\/api\/admin\/onboarding\/drafts\/([^/]+)\/invites$/.exec(url.pathname)
  if(onboardingInvites){
    await requireOnboardingAccess(session.admin,!isMethod(req,'GET'))
    if(!isMethod(req,'GET')){
      requireCsrf(req,session.rawToken)
      enforceRateLimit(`onboarding-invite:${session.admin.id}`,60,60_000)
    }
    if(isMethod(req,'GET')){json(res,200,await getOnboardingInvites(session.admin,onboardingInvites[1]!));return true}
    if(isMethod(req,'POST')){json(res,200,await createOnboardingInvite(session.admin,onboardingInvites[1]!));return true}
    throw new HttpError(405,'METHOD_NOT_ALLOWED','Этот метод не поддерживается.')
  }
  const onboarding=/^\/api\/admin\/onboarding\/drafts(?:\/([^/]+))?$/.exec(url.pathname)
  if(onboarding){
    await requireOnboardingAccess(session.admin,!isMethod(req,'GET'))
    const id=onboarding[1]
    if(!isMethod(req,'GET')){
      requireCsrf(req,session.rawToken)
      enforceRateLimit(`onboarding:${session.admin.id}`,60,60_000)
    }
    if(isMethod(req,'GET')){
      const requestKey=url.searchParams.get('requestKey')
      json(res,200,id?await getOnboardingDraft(session.admin,id):requestKey?await getOnboardingRequest(session.admin,requestKey):await getOnboardingIndex(session.admin));return true
    }
    if(!id&&isMethod(req,'POST')){
      json(res,200,await createOnboardingDraft(session.admin,await readJsonBody(req,8*1024)));return true
    }
    if(id&&isMethod(req,'PUT')){
      json(res,200,await updateOnboardingDraft(session.admin,id,await readJsonBody(req,8*1024)));return true
    }
    throw new HttpError(405,'METHOD_NOT_ALLOWED','Этот метод не поддерживается.')
  }
  if(isMethod(req,'GET')&&url.pathname==='/api/admin/venues'){
    json(res,200,{venues:await listAuthorizedVenues(session.admin)});return true
  }
  if(isMethod(req,'GET')&&url.pathname==='/api/admin/platform'){
    requireSuperAdmin(session.admin);json(res,200,await getAdminPlatformSummary());return true
  }
  if(isMethod(req,'GET')&&url.pathname==='/api/admin/developer'){
    requireSuperAdmin(session.admin);json(res,200,await getDeveloperOverview());return true
  }
  if(isMethod(req,'GET')&&url.pathname==='/api/admin/audit'){
    requireSuperAdmin(session.admin);json(res,200,await getAdminAudit(null,Number(url.searchParams.get('limit')||100)));return true
  }

  const parts=routeParts(url.pathname)
  if(parts[0]==='api'&&parts[1]==='admin'&&parts[2]==='venues'&&parts[3]){
    const scope=await resolveVenueScope(session.admin,parts[3])
    const resource=parts[4]||''
    const child=parts[5]||''
    const grandchild=parts[6]||''

    if(!isMethod(req,'GET')) {
      requireCsrf(req,session.rawToken)
    }
    await requireVenueAccess(session.admin,scope,String(req.method||'GET').toUpperCase(),resource,child,grandchild)

    if(resource==='clients'&&child&&grandchild==='bonus-adjustments'&&isMethod(req,'POST')){
      const body=await readJsonBody(req)
      json(res,200,await adjustPivnikBonusPilot(session.admin,scope,child,body));return true
    }
    if(resource==='clients'&&child&&grandchild==='entitlements'&&isMethod(req,'POST')){
      json(res,200,await grantCustomerEntitlement(session.admin,scope,child,await readJsonBody(req)));return true
    }
    if(resource==='clients'&&child&&grandchild==='cashback'&&isMethod(req,'PUT')){
      const body=await readJsonBody(req)
      json(res,200,await setCustomerCashbackOverride(session.admin,scope,child,body));return true
    }
    if(resource==='clients'&&child&&grandchild==='achievements'&&parts[7]==='grant'&&isMethod(req,'POST')){
      const body=await readJsonBody(req)
      json(res,200,await manualGrantAchievement(session.admin,scope,child,body));return true
    }

    if(resource==='app'&&child==='loyalty'&&!grandchild){
      if(isMethod(req,'GET')){json(res,200,await getAppLoyalty(scope));return true}
      if(isMethod(req,'PUT')){json(res,200,await saveAppLoyalty(session.admin,scope,await readJsonBody(req)));return true}
    }
    if(resource==='app'&&child==='wheel'&&!grandchild){
      if(isMethod(req,'GET')){json(res,200,await getAppWheel(scope));return true}
      if(isMethod(req,'PUT')){json(res,200,await saveAppWheel(session.admin,scope,await readJsonBody(req)));return true}
    }
    // Achievements and frames of the PIVNIK app: catalog settings and grants to one guest.
    if(resource==='app'&&child==='rewards'&&!grandchild&&isMethod(req,'GET')){json(res,200,await getAppRewards(scope));return true}
    if(resource==='app'&&child==='rewards'&&grandchild==='achievements'&&isMethod(req,'PUT')){json(res,200,await saveAppAchievements(session.admin,scope,await readJsonBody(req)));return true}
    if(resource==='clients'&&child&&grandchild==='rewards'&&isMethod(req,'GET')){json(res,200,await getGuestRewards(scope,child));return true}
    if(resource==='clients'&&child&&grandchild==='app-achievements'&&isMethod(req,'POST')){json(res,200,await grantGuestAchievement(session.admin,scope,child,await readJsonBody(req)));return true}
    if(resource==='clients'&&child&&grandchild==='frames'&&!parts[7]&&isMethod(req,'POST')){json(res,200,await grantGuestFrame(session.admin,scope,child,await readJsonBody(req)));return true}
    if(resource==='clients'&&child&&grandchild==='frames'&&parts[7]&&isMethod(req,'DELETE')){json(res,200,await revokeGuestFrame(session.admin,scope,child,parts[7]));return true}

    // Guest app content: these rows are what guests see in the PIVNIK app.
    if(resource==='app'&&child==='promotions'&&!grandchild){
      if(isMethod(req,'GET')){json(res,200,await listAppPromotions(scope));return true}
      if(isMethod(req,'POST')){json(res,200,await createAppPromotion(session.admin,scope,await readJsonBody(req,PROMOTION_BODY_LIMIT)));return true}
    }
    if(resource==='app'&&child==='promotions'&&grandchild){
      if(isMethod(req,'PUT')){json(res,200,await updateAppPromotion(session.admin,scope,grandchild,await readJsonBody(req,PROMOTION_BODY_LIMIT)));return true}
      if(isMethod(req,'DELETE')){json(res,200,await deleteAppPromotion(session.admin,scope,grandchild));return true}
    }
    if(resource==='app'&&child==='design'){
      if(isMethod(req,'GET')){json(res,200,await getAppDesign(scope));return true}
      if(isMethod(req,'PUT')){json(res,200,await publishAppDesign(session.admin,scope,await readJsonBody(req)));return true}
    }

    if(resource==='broadcast'&&child==='preview'&&isMethod(req,'GET')){json(res,200,await getBroadcastPreview(scope,url.searchParams.get('audience'),url.searchParams.get('segment')));return true}
    if(resource==='broadcast'&&!child){
      if(isMethod(req,'GET')){json(res,200,await listBroadcasts(scope));return true}
      if(isMethod(req,'POST')){json(res,200,await sendBroadcast(session.admin,scope,await readJsonBody(req)));return true}
    }

    if(resource==='loyalty'&&child==='manage'){
      if(isMethod(req,'GET')){json(res,200,await getManagedLoyalty(scope));return true}
      if(isMethod(req,'PUT')){json(res,200,await saveLoyalty(session.admin,scope,await readJsonBody(req)));return true}
    }
    if(resource==='wheel'&&child==='manage'){
      if(isMethod(req,'GET')){json(res,200,await getPivnikManagedWheelRead(scope));return true}
      if(isMethod(req,'PUT')){json(res,200,await saveWheel(session.admin,scope,await readJsonBody(req)));return true}
    }
    if(resource==='achievements'&&child==='manage'){
      if(isMethod(req,'GET')){json(res,200,await getPivnikManagedAchievementsRead(scope));return true}
      if(isMethod(req,'PUT')){json(res,200,await saveAchievements(session.admin,scope,await readJsonBody(req)));return true}
    }
    if(resource==='shop'&&child==='manage'){
      if(isMethod(req,'GET')){json(res,200,await getManagedShop(scope));return true}
      if(isMethod(req,'PUT')){json(res,200,await saveShop(session.admin,scope,await readJsonBody(req)));return true}
    }
    if(resource==='promotions'&&child==='manage'){
      if(isMethod(req,'GET')){json(res,200,await getManagedPromotions(scope));return true}
      if(isMethod(req,'PUT')){json(res,200,await savePromotions(session.admin,scope,await readJsonBody(req)));return true}
    }
    if(resource==='branding'&&child==='manage'){
      if(isMethod(req,'GET')){json(res,200,await getManagedBranding(scope));return true}
      if(isMethod(req,'PUT')){json(res,200,await saveBranding(session.admin,scope,await readJsonBody(req)));return true}
    }
    if(resource==='features'&&child==='manage'){
      if(isMethod(req,'GET')){json(res,200,await getManagedFeatures(scope));return true}
      if(isMethod(req,'PUT')){json(res,200,await saveFeatureSettings(session.admin,scope,await readJsonBody(req)));return true}
    }

    if(!isMethod(req,'GET')) throw new HttpError(405,'METHOD_NOT_ALLOWED','Эта операция не поддерживается.')
    if(resource==='pos'&&!child){
      const db=await readPool.connect()
      try{
        await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        const report=await getEvotorReport(db,scope,evotorPeriod(url))
        await db.query('COMMIT')
        json(res,200,report);return true
      }catch(error){await db.query('ROLLBACK');throw error}
      finally{db.release()}
    }
    if(resource==='dashboard'){json(res,200,await getVenueDashboard(scope,parsePeriod(url)));return true}
    if(resource==='clients'&&child==='segments'){json(res,200,await getClientSegments(scope));return true}
    if(resource==='clients'&&child){json(res,200,await getClientDetail(scope,child));return true}
    if(resource==='clients'){json(res,200,await getClients(scope,url));return true}
    if(resource==='operations'){json(res,200,await getOperations(scope,url));return true}
    if(resource==='achievements'){json(res,200,await getAchievementAnalytics(scope));return true}
    if(resource==='wheel'){json(res,200,await getWheelAnalytics(scope,parsePeriod(url)));return true}
    if(resource==='shop'){json(res,200,await getShop(scope,parsePeriod(url)));return true}
    if(resource==='promotions'){json(res,200,await getPromotions(scope));return true}
    if(resource==='design'){json(res,200,await getLegacyDesign(scope));return true}
    if(resource==='capabilities'){json(res,200,await getCapabilities(scope));return true}
    if(resource==='audit'){json(res,200,await getAdminAudit(scope,Number(url.searchParams.get('limit')||100)));return true}
    throw new HttpError(404,'ADMIN_ROUTE_NOT_FOUND','Admin API route not found.')
  }

  throw new HttpError(404,'ADMIN_ROUTE_NOT_FOUND','Admin API route not found.')
}

export function sendApiError(res:ServerResponse,error:unknown,req?:IncomingMessage):void{
  const known=error instanceof HttpError?error:new HttpError(500,'INTERNAL_ERROR','Не удалось выполнить операцию. Повторите попытку.')
  if(!(error instanceof HttpError))console.error('Admin API error:',error)
  if(known.statusCode>=500&&req)rememberServerError(String(req.method||'GET'),String(req.url||'').split('?')[0]!,error)
  json(res,known.statusCode,{error:known.message,code:known.code,details:known.details})
}
