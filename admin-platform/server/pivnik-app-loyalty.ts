import { config } from './config.js'
import { recordAudit } from './audit.js'
import { appLinkConfigured,callApp } from './pivnik-app-link.js'
import { enforceRateLimit } from './security.js'
import { HttpError, type AdminPrincipal, type VenueScope } from './types.js'

// Guest status levels and the welcome bonus of the PIVNIK app (loyalty-config.js in the app).

export interface AppLoyalty {
  levels:Array<{name:string;minCents:number;bonusPercent:number;discountPercent:number;guests:number}>
  welcomeBonus:number;updatedAt:string|null;updatedBy:string|null
}

function requireLinkedVenue(scope:VenueScope):void {
  if(scope.companyCode!=='pivnik'||!scope.legacyBarId) throw new HttpError(409,'APP_CONTENT_NOT_LINKED','Это заведение пока не связано с приложением ПИВНИК.')
}
const app=<T>(method='GET',body?:unknown)=>callApp<T>('/api/internal/business/loyalty',{method,body,timeoutMs:20_000,
  errorCode:'APP_LOYALTY_ERROR',unreachableCode:'APP_LOYALTY_UNREACHABLE',failMessage:'Приложение не приняло изменение.'})

export async function getAppLoyalty(scope:VenueScope):Promise<(AppLoyalty&{configured:true;writesEnabled:boolean})|{configured:false}> {
  requireLinkedVenue(scope)
  if(!appLinkConfigured()) return {configured:false}
  return {...await app<AppLoyalty>(),configured:true,writesEnabled:config.enableWrites}
}

export function loyaltyInput(raw:unknown){
  const body=(raw&&typeof raw==='object'?raw:{}) as Record<string,unknown>
  const levels=Array.isArray(body.levels)?body.levels as Array<Record<string,unknown>>:null
  if(!levels||!levels.length||levels.length>12) throw new HttpError(400,'LEVELS_INVALID','Нужно от 1 до 12 уровней.')
  return {
    levels:levels.map(level=>({name:String(level.name??'').trim(),minCents:Number(level.minCents),bonusPercent:Number(level.bonusPercent),discountPercent:Number(level.discountPercent??0)})),
    welcomeBonus:Number(body.welcomeBonus),
  }
}

export async function saveAppLoyalty(admin:AdminPrincipal,scope:VenueScope,raw:unknown):Promise<AppLoyalty> {
  if(!config.enableWrites) throw new HttpError(405,'WRITES_DISABLED','Изменения отключены на этом окружении.')
  requireLinkedVenue(scope)
  if(!appLinkConfigured()) throw new HttpError(503,'APP_LINK_NOT_CONFIGURED','Панель не связана с приложением: нужны PIVNIK_APP_URL и BUSINESS_INTERNAL_TOKEN.')
  enforceRateLimit(`loyalty:${admin.id}`,30,10*60_000)
  const settings=loyaltyInput(raw)
  const before=await app<AppLoyalty>()
  const after=await app<AppLoyalty>('PUT',{settings,updatedBy:admin.displayName||admin.email})
  const brief=(r:AppLoyalty)=>({welcomeBonus:r.welcomeBonus,levels:r.levels.map(({name,minCents,bonusPercent,discountPercent})=>({name,minCents,bonusPercent,discountPercent}))})
  await recordAudit({admin,scope,action:'app.loyalty_save',entityType:'app_loyalty',entityId:'loyalty',before:brief(before),after:brief(after)}).catch(()=>undefined)
  return after
}
