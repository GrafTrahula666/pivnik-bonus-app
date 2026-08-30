import type { IncomingMessage, ServerResponse } from 'node:http'
import { login, loadSession, logout, requireCsrf } from './auth.js'
import { pool, readPool, writePool } from './db.js'
import { config } from './config.js'
import {
  getAchievementAnalytics,
  getAudit,
  getCapabilities,
  getClientDetail,
  getClients,
  getLegacyDesign,
  getOperations,
  getPlatformSummary,
  getPromotions,
  getShop,
  getVenueDashboard,
  getWheelAnalytics,
  parsePeriod,
} from './data.js'
import { recordAudit } from './audit.js'
import { enforceOrigin, readJsonBody, requestIp, securityHeaders } from './security.js'
import {
  listAuthorizedVenues,
  requireSuperAdmin,
  resolveVenueScope,
} from './tenant.js'
import {
  adjustPivnikBonus,
  getManagedAchievements,
  getManagedBranding,
  getManagedFeatures,
  getManagedLoyalty,
  getManagedPromotions,
  getManagedShop,
  getManagedWheel,
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
import { HttpError } from './types.js'

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

export async function handleApi(req:IncomingMessage,res:ServerResponse,url:URL):Promise<boolean>{
  if(!url.pathname.startsWith('/api/admin/')) return false
  enforceOrigin(req)

  if(isMethod(req,'GET')&&url.pathname==='/api/admin/health'){
    try{
      const [db,readDb,schema]=await Promise.all([
        pool.query<{now:string}>('SELECT NOW()::text AS now'),
        readPool.query<{default_transaction_read_only:string}>('SHOW default_transaction_read_only'),
        pool.query<{exists:boolean}>(`SELECT to_regclass('public.admin_accounts') IS NOT NULL AS exists`),
      ])
      json(res,schema.rows[0]?.exists?200:503,{
        ok:Boolean(schema.rows[0]?.exists),
        adminSchema:Boolean(schema.rows[0]?.exists),
        productionReadPool:readDb.rows[0]?.default_transaction_read_only==='on'?'read-only':'unexpected-mode',
        writesEnabled:config.enableWrites,
        productionBonusWritesEnabled:config.enableProductionBonusWrites,
        productionAchievementWritesEnabled:config.enableProductionAchievementWrites,
        productionWriterConfigured:Boolean(writePool),
        demoEnabled:config.demoEnabled,
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
    json(res,200,result);return true
  }

  const session=await loadSession(req)

  if(isMethod(req,'GET')&&url.pathname==='/api/admin/auth/session'){
    json(res,200,{
      admin:session.admin,csrfToken:session.csrfToken,
      capabilities:{
        writes:config.enableWrites,
        productionBonusWrites:config.enableProductionBonusWrites,
        productionAchievementWrites:config.enableProductionAchievementWrites,
        productionEntitlementWrites:config.enableProductionEntitlementWrites,
        demo:config.demoEnabled,
      },
    });return true
  }
  if(isMethod(req,'POST')&&url.pathname==='/api/admin/auth/logout'){
    requireCsrf(req,session.rawToken)
    await recordAudit({admin:session.admin,action:'auth.logout',entityType:'admin_session',metadata:{ipPresent:Boolean(requestIp(req))}}).catch(()=>undefined)
    await logout(req,res);json(res,200,{ok:true});return true
  }
  if(isMethod(req,'GET')&&url.pathname==='/api/admin/venues'){
    json(res,200,{venues:await listAuthorizedVenues(session.admin)});return true
  }
  if(isMethod(req,'GET')&&url.pathname==='/api/admin/platform'){
    requireSuperAdmin(session.admin);json(res,200,await getPlatformSummary());return true
  }
  if(isMethod(req,'GET')&&url.pathname==='/api/admin/audit'){
    requireSuperAdmin(session.admin);json(res,200,await getAudit(null,Number(url.searchParams.get('limit')||100)));return true
  }

  const parts=routeParts(url.pathname)
  if(parts[0]==='api'&&parts[1]==='admin'&&parts[2]==='venues'&&parts[3]){
    const scope=await resolveVenueScope(session.admin,parts[3])
    const resource=parts[4]||''
    const child=parts[5]||''
    const grandchild=parts[6]||''

    if(!isMethod(req,'GET')) requireCsrf(req,session.rawToken)

    // Customer mutation routes always derive tenant from URL scope + authenticated session.
    if(resource==='clients'&&child&&grandchild==='bonus-adjustments'&&isMethod(req,'POST')){
      const body=await readJsonBody(req)
      json(res,200,await adjustPivnikBonus(session.admin,scope,child,body));return true
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

    // Whole-config manager routes.
    if(resource==='loyalty'&&child==='manage'){
      if(isMethod(req,'GET')){json(res,200,await getManagedLoyalty(scope));return true}
      if(isMethod(req,'PUT')){json(res,200,await saveLoyalty(session.admin,scope,await readJsonBody(req)));return true}
    }
    if(resource==='wheel'&&child==='manage'){
      if(isMethod(req,'GET')){json(res,200,await getManagedWheel(scope));return true}
      if(isMethod(req,'PUT')){json(res,200,await saveWheel(session.admin,scope,await readJsonBody(req)));return true}
    }
    if(resource==='achievements'&&child==='manage'){
      if(isMethod(req,'GET')){json(res,200,await getManagedAchievements(scope));return true}
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

    // Read adapters.
    if(!isMethod(req,'GET')) throw new HttpError(405,'METHOD_NOT_ALLOWED','Эта операция не поддерживается.')
    if(resource==='dashboard'){json(res,200,await getVenueDashboard(scope,parsePeriod(url)));return true}
    if(resource==='clients'&&child){json(res,200,await getClientDetail(scope,child));return true}
    if(resource==='clients'){json(res,200,await getClients(scope,url));return true}
    if(resource==='operations'){json(res,200,await getOperations(scope,url));return true}
    if(resource==='achievements'){json(res,200,await getAchievementAnalytics(scope));return true}
    if(resource==='wheel'){json(res,200,await getWheelAnalytics(scope,parsePeriod(url)));return true}
    if(resource==='shop'){json(res,200,await getShop(scope,parsePeriod(url)));return true}
    if(resource==='promotions'){json(res,200,await getPromotions(scope));return true}
    if(resource==='design'){json(res,200,await getLegacyDesign(scope));return true}
    if(resource==='capabilities'){json(res,200,await getCapabilities(scope));return true}
    if(resource==='audit'){json(res,200,await getAudit(scope,Number(url.searchParams.get('limit')||100)));return true}
    throw new HttpError(404,'ADMIN_ROUTE_NOT_FOUND','Admin API route not found.')
  }

  throw new HttpError(404,'ADMIN_ROUTE_NOT_FOUND','Admin API route not found.')
}

export function sendApiError(res:ServerResponse,error:unknown):void{
  const known=error instanceof HttpError?error:new HttpError(500,'INTERNAL_ERROR','Не удалось выполнить операцию. Повторите попытку.')
  if(!(error instanceof HttpError))console.error('Admin API error:',error)
  json(res,known.statusCode,{error:known.message,code:known.code,details:known.details})
}
