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
import { enforceOrigin, readJsonBody, requestIp, securityHeaders } from './security.js'
import {
  listAuthorizedVenues,
  requireSuperAdmin,
  resolveVenueScope,
} from './tenant.js'
import { adjustPivnikBonusPilot } from './bonus-pilot-writer.js'
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
})

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
    json(res,200,{...result,capabilities:sessionCapabilities()});return true
  }

  if(isMethod(req,'GET')&&url.pathname==='/api/admin/auth/session'){
    try{
      const session=await loadSession(req)
      json(res,200,{admin:session.admin,csrfToken:session.csrfToken,capabilities:sessionCapabilities()})
    }catch(error){
      if(error instanceof HttpError&&error.statusCode===401)json(res,200,{authenticated:false,demo:config.demoEnabled})
      else throw error
    }
    return true
  }

  const session=await loadSession(req)
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

    if(!isMethod(req,'GET')) requireCsrf(req,session.rawToken)

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
