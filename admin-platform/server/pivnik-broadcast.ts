import { config } from './config.js'
import { pool, productionTableExists, readPool } from './db.js'
import { recordAudit } from './audit.js'
import { CLIENT_SEGMENTS,getSegmentUserIds,type ClientSegment } from './data.js'
import { enforceRateLimit } from './security.js'
import { HttpError, type AdminPrincipal, type VenueScope } from './types.js'

// Broadcasts are sent by the guest app, which holds the Telegram and VK bot tokens and applies the
// audience rule (accepted the rules, minus promo opt-outs). Business calls its internal routes.

export const BROADCAST_MAX_TEXT=3000
const AUDIENCES=new Set(['clients','all'])
const CHANNELS=new Set(['telegram','vk','all'])

function requirePivnik(scope:VenueScope):void {
  if(scope.companyCode!=='pivnik'||!scope.legacyBarId) throw new HttpError(409,'APP_CONTENT_NOT_LINKED','Это заведение пока не связано с приложением ПИВНИК.')
}
export function broadcastConfigured():boolean {
  return Boolean(config.pivnikAppUrl&&config.businessInternalToken.length>=32)
}
function requireConfigured():void {
  if(!broadcastConfigured()) throw new HttpError(503,'BROADCAST_NOT_CONFIGURED','Рассылки ещё не подключены: нужны PIVNIK_APP_URL и BUSINESS_INTERNAL_TOKEN.')
}

type Fetch=typeof fetch
let fetcher:Fetch=(...args)=>fetch(...args)
export function setBroadcastFetchForTests(next:Fetch|null):void { fetcher=next||((...args)=>fetch(...args)) }

async function callApp<T>(path:string,init:{method?:string;body?:unknown;timeoutMs:number}):Promise<T> {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),init.timeoutMs)
  try{
    const response=await fetcher(`${config.pivnikAppUrl}${path}`,{
      method:init.method||'GET',signal:controller.signal,
      headers:{'x-business-token':config.businessInternalToken,...(init.body?{'content-type':'application/json'}:{})},
      body:init.body?JSON.stringify(init.body):undefined,
    })
    const data=await response.json().catch(()=>({})) as Record<string,unknown>
    if(!response.ok){
      if(response.status===401||response.status===404) throw new HttpError(502,'BROADCAST_APP_ERROR','Приложение не принимает ключ связи: проверьте BUSINESS_INTERNAL_TOKEN на обоих сервисах.')
      const message=typeof data.error==='string'&&(response.status<500||response.status===503)?data.error:''
      throw new HttpError(response.status,'BROADCAST_APP_ERROR',message||'Приложение не приняло запрос на рассылку.')
    }
    return data as T
  }catch(error){
    if(error instanceof HttpError) throw error
    throw new HttpError(502,'BROADCAST_APP_UNREACHABLE',(error as Error)?.name==='AbortError'?'Приложение не ответило вовремя. Проверьте результат в истории, прежде чем отправлять снова.':'Не удалось связаться с приложением.')
  }finally{clearTimeout(timer)}
}

export interface BroadcastPreview {
  audience:string;totalUsers:number;activeUsers:number;truncated:boolean;telegramRecipients:number;vkRecipients:number
  telegramConfigured:boolean;vkConfigured:boolean;maxRecipients:number
}
const isSegment=(value:unknown):value is ClientSegment=>(CLIENT_SEGMENTS as readonly string[]).includes(String(value))

export async function getBroadcastPreview(scope:VenueScope,rawAudience:string|null,rawSegment:string|null=null):Promise<BroadcastPreview> {
  requirePivnik(scope);requireConfigured()
  if(rawSegment){
    if(!isSegment(rawSegment)) throw new HttpError(400,'SEGMENT_INVALID','Неизвестный сегмент.')
    const userIds=await getSegmentUserIds(scope,rawSegment)
    return await callApp<BroadcastPreview>('/api/internal/business/broadcast/preview',{method:'POST',body:{segment:rawSegment,userIds},timeoutMs:15_000})
  }
  const audience=AUDIENCES.has(String(rawAudience||'clients'))?String(rawAudience||'clients'):'clients'
  return await callApp<BroadcastPreview>(`/api/internal/business/broadcast/preview?audience=${audience}`,{timeoutMs:15_000})
}

export function validateBroadcastInput(raw:unknown):{channel:string;audience:string;message:string;segment?:ClientSegment} {
  const b=(raw&&typeof raw==='object'?raw:{}) as Record<string,unknown>
  const channel=String(b.channel||''),audience=String(b.audience||'clients'),message=String(b.message||'').trim()
  if(b.segment!==undefined&&b.segment!==null&&b.segment!==''&&!isSegment(b.segment)) throw new HttpError(400,'SEGMENT_INVALID','Неизвестный сегмент.')
  if(!CHANNELS.has(channel)) throw new HttpError(400,'CHANNEL_INVALID','Выберите канал рассылки.')
  if(!AUDIENCES.has(audience)) throw new HttpError(400,'AUDIENCE_INVALID','Недопустимая аудитория рассылки.')
  if(!message) throw new HttpError(400,'MESSAGE_REQUIRED','Введите текст рассылки.')
  if(message.length>BROADCAST_MAX_TEXT) throw new HttpError(400,'MESSAGE_TOO_LONG',`Сообщение длиннее ${BROADCAST_MAX_TEXT} символов.`)
  return isSegment(b.segment)?{channel,audience:'clients',message,segment:b.segment}:{channel,audience,message}
}

interface DeliveryResult {attempted:number;delivered:number;failed:number;skipped?:string}
export interface BroadcastResult {ok:true;deduplicated:boolean;campaignId:string;totalUsers:number;truncated:boolean;telegram:DeliveryResult;vk:DeliveryResult}

export async function sendBroadcast(admin:AdminPrincipal,scope:VenueScope,raw:unknown):Promise<BroadcastResult> {
  if(!config.enableWrites) throw new HttpError(405,'WRITES_DISABLED','Изменения отключены на этом окружении.')
  requirePivnik(scope);requireConfigured()
  const input=validateBroadcastInput(raw)
  enforceRateLimit(`broadcast:${admin.id}`,5,10*60_000)
  // Delivery runs inside this request on the app side (about 40-70 ms per guest), so allow a few minutes.
  const body=input.segment?{...input,userIds:await getSegmentUserIds(scope,input.segment)}:input
  const result=await callApp<BroadcastResult>('/api/internal/business/broadcast',{method:'POST',body,timeoutMs:5*60_000})
  const summary=(d:DeliveryResult)=>({attempted:d?.attempted||0,delivered:d?.delivered||0,failed:d?.failed||0,skipped:d?.skipped||null})
  await recordAudit({admin,scope,action:'app.broadcast_send',entityType:'broadcast_campaign',entityId:String(result.campaignId),
    after:{channel:input.channel,audience:input.audience,segment:input.segment||null,message:input.message,deduplicated:result.deduplicated,totalUsers:result.totalUsers,
      telegram:summary(result.telegram),vk:summary(result.vk)}}).catch(()=>undefined)
  return result
}

export interface BroadcastHistoryItem {
  id:string;status:string;channel:string;audience:string;totalUsers:number;createdAt:string;completedAt:string|null
  telegramDelivered:number;telegramFailed:number;vkDelivered:number;vkFailed:number;message:string|null;sentBy:string|null;segment:string|null
}
export async function listBroadcasts(scope:VenueScope):Promise<{configured:boolean;writesEnabled:boolean;items:BroadcastHistoryItem[]}> {
  requirePivnik(scope)
  const base={configured:broadcastConfigured(),writesEnabled:config.enableWrites}
  if(!(await productionTableExists('broadcast_campaigns'))) return {...base,items:[]}
  const r=await readPool.query<{id:string;status:string;channel:string;audience:string;total_users:number;created_at:string;completed_at:string|null;
    telegram_delivered:number;telegram_failed:number;vk_delivered:number;vk_failed:number}>(
    `SELECT id::text,status,channel,audience,total_users,created_at,completed_at,telegram_delivered,telegram_failed,vk_delivered,vk_failed
     FROM broadcast_campaigns ORDER BY created_at DESC LIMIT 30`)
  // The app keeps only a hash of the text; Business remembers the text of what it sent.
  const ids=r.rows.map(x=>x.id)
  const sent=ids.length?await pool.query<{entity_id:string;message:string|null;sent_by:string|null;segment:string|null}>(
    `SELECT l.entity_id,l.after_value->>'message' AS message,l.after_value->>'segment' AS segment,a.display_name AS sent_by
     FROM admin_audit_log l LEFT JOIN admin_accounts a ON a.id=l.admin_id
     WHERE l.action='app.broadcast_send' AND l.entity_id=ANY($1::text[])`,[ids]):{rows:[]}
  const byId=new Map(sent.rows.map(x=>[x.entity_id,x]))
  return {...base,items:r.rows.map(x=>({
    id:x.id,status:x.status,channel:x.channel,audience:x.audience,totalUsers:Number(x.total_users||0),createdAt:x.created_at,completedAt:x.completed_at,
    telegramDelivered:Number(x.telegram_delivered||0),telegramFailed:Number(x.telegram_failed||0),vkDelivered:Number(x.vk_delivered||0),vkFailed:Number(x.vk_failed||0),
    message:byId.get(x.id)?.message??null,sentBy:byId.get(x.id)?.sent_by??null,segment:byId.get(x.id)?.segment??null,
  }))}
}
