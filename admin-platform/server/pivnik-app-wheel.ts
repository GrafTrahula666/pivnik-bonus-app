import { config } from './config.js'
import { recordAudit } from './audit.js'
import { appLinkConfigured,callApp } from './pivnik-app-link.js'
import { enforceRateLimit } from './security.js'
import { HttpError, type AdminPrincipal, type VenueScope } from './types.js'

// Wheel of the PIVNIK app (wheel.js in the app): chances of the regular prizes, paid spin prices
// and the free spin interval. Prize amounts are fixed by the approved wheel artwork.

export interface AppWheelSettings {chances:Record<string,number>;firstPaidCost:number;nextPaidCost:number;freeIntervalHours:number}
export interface AppWheel {
  settings:AppWheelSettings
  prizes:Array<{code:string;title:string;bonus:number;beerMl:number;annualSupply:boolean;chancePercent:number}>
  last30Days:{spins:number;paidSpins:number;bonusSpent:number;bonusAwarded:number;beerAwardedMl:number;guests:number}
  updatedAt:string|null;updatedBy:string|null
}

function requireLinkedVenue(scope:VenueScope):void {
  if(scope.companyCode!=='pivnik'||!scope.legacyBarId) throw new HttpError(409,'APP_CONTENT_NOT_LINKED','Это заведение пока не связано с приложением ПИВНИК.')
}
const app=<T>(method='GET',body?:unknown)=>callApp<T>('/api/internal/business/wheel',{method,body,timeoutMs:20_000,
  errorCode:'APP_WHEEL_ERROR',unreachableCode:'APP_WHEEL_UNREACHABLE',failMessage:'Приложение не приняло изменение.'})

export async function getAppWheel(scope:VenueScope):Promise<(AppWheel&{configured:true;writesEnabled:boolean})|{configured:false}> {
  requireLinkedVenue(scope)
  if(!appLinkConfigured()) return {configured:false}
  return {...await app<AppWheel>(),configured:true,writesEnabled:config.enableWrites}
}

export function wheelInput(raw:unknown):AppWheelSettings {
  const body=(raw&&typeof raw==='object'?raw:{}) as Record<string,unknown>
  const chances=body.chances&&typeof body.chances==='object'?body.chances as Record<string,unknown>:null
  if(!chances) throw new HttpError(400,'WHEEL_CHANCES_INVALID','Укажите шансы призов.')
  return {
    chances:Object.fromEntries(Object.entries(chances).slice(0,20).map(([code,value])=>[code.slice(0,40),Number(value)])),
    firstPaidCost:Number(body.firstPaidCost),nextPaidCost:Number(body.nextPaidCost),freeIntervalHours:Number(body.freeIntervalHours),
  }
}

export async function saveAppWheel(admin:AdminPrincipal,scope:VenueScope,raw:unknown):Promise<AppWheel> {
  if(!config.enableWrites) throw new HttpError(405,'WRITES_DISABLED','Изменения отключены на этом окружении.')
  requireLinkedVenue(scope)
  if(!appLinkConfigured()) throw new HttpError(503,'APP_LINK_NOT_CONFIGURED','Панель не связана с приложением: нужны PIVNIK_APP_URL и BUSINESS_INTERNAL_TOKEN.')
  enforceRateLimit(`wheel:${admin.id}`,30,10*60_000)
  const settings=wheelInput(raw)
  const before=await app<AppWheel>()
  const after=await app<AppWheel>('PUT',{settings,updatedBy:admin.displayName||admin.email})
  await recordAudit({admin,scope,action:'app.wheel_save',entityType:'app_wheel',entityId:'wheel',before:before.settings,after:after.settings}).catch(()=>undefined)
  return after
}
