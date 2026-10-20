import { config } from './config.js'
import { recordAudit } from './audit.js'
import { appLinkConfigured,callApp } from './pivnik-app-link.js'
import { enforceRateLimit } from './security.js'
import { HttpError, type AdminPrincipal, type VenueScope } from './types.js'

// Achievements and frames live in the guest app (achievements.js, user_frames). Business reads and
// changes them through the app, so a grant pays the reward and shows up in the guest's profile.

export interface AppAchievement {
  code:string;title:string;description:string;rarity:string;metric:string;target:number;unit:string;recurring:string|null
  rewardBonus:number;rewardBeerMl:number;defaultRewardBonus:number|null;enabled:boolean;manual:boolean;guests:number
}
export interface AppFrame {code:string;title:string;guests:number}
export interface AppRewards {achievements:AppAchievement[];frames:AppFrame[];updatedAt:string|null;updatedBy:string|null}
export interface GuestRewards {
  selectedFrame:string
  achievements:Array<{code:string;title:string;grantedAt:string;times:number}>
  frames:Array<{code:string;title:string;source:string;acquiredAt:string;removable:boolean}>
}

function requireLinkedVenue(scope:VenueScope):void {
  if(scope.companyCode!=='pivnik'||!scope.legacyBarId) throw new HttpError(409,'APP_CONTENT_NOT_LINKED','Это заведение пока не связано с приложением ПИВНИК.')
}
function requirePivnik(scope:VenueScope):void {
  requireLinkedVenue(scope)
  if(!appLinkConfigured()) throw new HttpError(503,'APP_LINK_NOT_CONFIGURED','Панель не связана с приложением: нужны PIVNIK_APP_URL и BUSINESS_INTERNAL_TOKEN.')
}
function requireWriter(admin:AdminPrincipal,scope:VenueScope,action:string):void {
  if(!config.enableWrites) throw new HttpError(405,'WRITES_DISABLED','Изменения отключены на этом окружении.')
  requirePivnik(scope)
  enforceRateLimit(`rewards:${action}:${admin.id}`,60,10*60_000)
}
const app=<T>(path:string,method='GET',body?:unknown)=>callApp<T>(path,{method,body,timeoutMs:20_000,
  errorCode:'APP_REWARDS_ERROR',unreachableCode:'APP_REWARDS_UNREACHABLE',failMessage:'Приложение не приняло изменение.'})
const guestPath=(rawUserId:string)=>{
  if(!/^\d{1,18}$/.test(rawUserId)) throw new HttpError(400,'USER_ID_INVALID','Некорректный гость.')
  return `/api/internal/business/users/${rawUserId}`
}
const codeOf=(value:unknown)=>{
  const code=String(value??'').trim()
  if(!/^[a-z0-9-]{1,80}$/.test(code)) throw new HttpError(400,'CODE_INVALID','Выберите из списка.')
  return code
}

// Without the link to the app the page falls back to the read-only catalog.
export async function getAppRewards(scope:VenueScope):Promise<(AppRewards&{configured:true;writesEnabled:boolean})|{configured:false}> {
  requireLinkedVenue(scope)
  if(!appLinkConfigured()) return {configured:false}
  return {...await app<AppRewards>('/api/internal/business/rewards'),configured:true,writesEnabled:config.enableWrites}
}

// Only the editable part is sent on: overrides for built-in achievements and the owner's own ones.
export function achievementSettingsInput(raw:unknown){
  const body=(raw&&typeof raw==='object'?raw:{}) as Record<string,unknown>
  const items=Array.isArray(body.achievements)?body.achievements as Array<Record<string,unknown>>:null
  if(!items||items.length>200) throw new HttpError(400,'ACHIEVEMENTS_INVALID','Список достижений не передан.')
  const overrides:Record<string,{enabled:boolean;rewardBonus:number}>={}
  const custom:Array<{code:string;title:string;description:string;rarity:string;rewardBonus:number}>=[]
  for(const item of items){
    const rewardBonus=Number(item.rewardBonus)
    if(!Number.isSafeInteger(rewardBonus)||rewardBonus<0||rewardBonus>100_000) throw new HttpError(400,'REWARD_INVALID',`«${String(item.title||item.code)}»: награда от 0 до 100 000 бонусов.`)
    if(item.manual) custom.push({code:codeOf(item.code),title:String(item.title||'').trim(),description:String(item.description||'').trim(),rarity:String(item.rarity||'rare'),rewardBonus})
    else overrides[codeOf(item.code)]={enabled:item.enabled!==false,rewardBonus}
  }
  return {overrides,custom}
}

export async function saveAppAchievements(admin:AdminPrincipal,scope:VenueScope,raw:unknown):Promise<AppRewards> {
  requireWriter(admin,scope,'achievements')
  const settings=achievementSettingsInput(raw)
  const before=await app<AppRewards>('/api/internal/business/rewards')
  const after=await app<AppRewards>('/api/internal/business/rewards/achievements','PUT',{settings,updatedBy:admin.displayName||admin.email})
  const brief=(r:AppRewards)=>r.achievements.map(a=>({code:a.code,title:a.title,enabled:a.enabled,rewardBonus:a.rewardBonus}))
  await recordAudit({admin,scope,action:'app.achievements_save',entityType:'app_achievements',entityId:'achievements',before:brief(before),after:brief(after)}).catch(()=>undefined)
  return after
}

export async function getGuestRewards(scope:VenueScope,rawUserId:string):Promise<GuestRewards> {
  requirePivnik(scope)
  return await app<GuestRewards>(`${guestPath(rawUserId)}/rewards`)
}

export async function grantGuestAchievement(admin:AdminPrincipal,scope:VenueScope,rawUserId:string,raw:unknown){
  requireWriter(admin,scope,'grant')
  const code=codeOf((raw as Record<string,unknown>|null)?.code)
  const result=await app<{granted:{code:string;title:string;rewardBonus:number;rewardBeerMl:number;balance:number};rewards:GuestRewards}>(
    `${guestPath(rawUserId)}/achievements`,'POST',{code})
  await recordAudit({admin,scope,action:'app.achievement_grant',entityType:'customer_achievement',entityId:`${rawUserId}:${code}`,
    after:{title:result.granted.title,rewardBonus:result.granted.rewardBonus,rewardBeerMl:result.granted.rewardBeerMl}}).catch(()=>undefined)
  return result
}

export async function grantGuestFrame(admin:AdminPrincipal,scope:VenueScope,rawUserId:string,raw:unknown):Promise<GuestRewards> {
  requireWriter(admin,scope,'frame')
  const code=codeOf((raw as Record<string,unknown>|null)?.code)
  const result=await app<GuestRewards>(`${guestPath(rawUserId)}/frames`,'POST',{code})
  await recordAudit({admin,scope,action:'app.frame_grant',entityType:'customer_frame',entityId:`${rawUserId}:${code}`,after:{frame:code}}).catch(()=>undefined)
  return result
}

export async function revokeGuestFrame(admin:AdminPrincipal,scope:VenueScope,rawUserId:string,rawCode:string):Promise<GuestRewards> {
  requireWriter(admin,scope,'frame')
  const code=codeOf(rawCode)
  const result=await app<GuestRewards>(`${guestPath(rawUserId)}/frames/${code}`,'DELETE')
  await recordAudit({admin,scope,action:'app.frame_revoke',entityType:'customer_frame',entityId:`${rawUserId}:${code}`,before:{frame:code}}).catch(()=>undefined)
  return result
}
