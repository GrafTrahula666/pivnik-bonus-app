import crypto from 'node:crypto'
import type { PoolClient,QueryResultRow } from 'pg'
import { config } from './config.js'
import { pool } from './db.js'
import { recordAudit } from './audit.js'
import { loadOwnedOnboardingRuntimeSource,requireOnboardingAccess } from './venue-onboarding.js'
import { onboardingSecretBox } from './onboarding-secrets.js'
import { resolveOnboardingProxyOrigin } from './onboarding-proxy-registry.js'
import { HttpError,type AdminPrincipal } from './types.js'
import { POS_DEVICE_KEY_PATTERN,POS_EVENT_FRESH_MS,verifyPosOnboardingPacket } from '../../pos/onboarding-proxy.js'

interface Source{draftId:string;companyId:string;venueId:string;runtimeKey:string;checksum:string;terminalId:string}
interface ProxyRow extends QueryResultRow{
 draft_id:string;company_id:string;venue_id:string;runtime_key:string;manifest_sha256:string;store_id:string;terminal_id:string
 secret_key_id:string;secret_nonce:Buffer|Uint8Array;secret_ciphertext:Buffer|Uint8Array;secret_auth_tag:Buffer|Uint8Array
 request_key:string;request_revision:number;request_fingerprint:string;revision:number;status:string
 lease_token:string|null;lease_active:boolean;last_code:string;checked_at:string|null;verified_at:string|null
 last_device_event_at:string|null;report:Report|null;updated_at:string
}
interface Report{state:'available'|'unavailable';empty:boolean|null;netCents:string|null;receiptCount:number|null;period:{from:string;until:string}|null}
const emptyReport=():Report=>({state:'unavailable',empty:null,netCents:null,receiptCount:null,period:null})
const columns=`draft_id::text,company_id::text,venue_id::text,runtime_key,manifest_sha256,store_id,terminal_id,
 secret_key_id,secret_nonce,secret_ciphertext,secret_auth_tag,request_key::text,request_revision,request_fingerprint,
 revision,status,lease_token::text,(lease_expires_at>NOW()) AS lease_active,last_code,checked_at::text,
 verified_at::text,last_device_event_at::text,report,updated_at::text`
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
async function packetBody(response:Response):Promise<unknown>{
 const reader=response.body?.getReader();if(!reader)throw new Error('proxy_response_invalid')
 const chunks:Uint8Array[]=[];let size=0
 try{
  for(;;){const part=await reader.read();if(part.done)break
   size+=part.value.byteLength;if(size>65_536){await reader.cancel();throw new Error('proxy_response_invalid')}
   chunks.push(part.value)
  }
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw new Error('proxy_response_invalid')}
 }finally{reader.releaseLock()}
}
const unavailable=()=>new HttpError(503,'ONBOARDING_POS_PROXY_UNAVAILABLE','Не удалось подтвердить подключение кассы. Повторите тот же запрос.')
const invalid=()=>new HttpError(400,'ONBOARDING_POS_PROXY_INVALID','Проверьте магазин и X-Pivnik-Device-Key. Статус, адрес и область задаёт сервер.')
function exact(raw:unknown,keys:string[]):Record<string,unknown>{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(key=>!keys.includes(key)))throw invalid()
 return raw as Record<string,unknown>
}
function command(raw:unknown){
 const input=exact(raw,['requestKey','revision','storeId','deviceKey'])
 if(typeof input.requestKey!=='string'||!uuid.test(input.requestKey)||typeof input.revision!=='number'
  ||!Number.isSafeInteger(input.revision)||input.revision<0||input.revision>=2147483647
  ||typeof input.storeId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(input.storeId)
  ||typeof input.deviceKey!=='string'||!POS_DEVICE_KEY_PATTERN.test(input.deviceKey))throw invalid()
 return {requestKey:input.requestKey.toLowerCase(),revision:input.revision,storeId:input.storeId,deviceKey:input.deviceKey}
}
function matches(row:ProxyRow,src:Source){return row.company_id===src.companyId&&row.venue_id===src.venueId
 &&row.runtime_key===src.runtimeKey&&row.manifest_sha256===src.checksum&&row.terminal_id===src.terminalId}
function sourceOf(row:ProxyRow):Source{return {draftId:row.draft_id,companyId:row.company_id,venueId:row.venue_id,runtimeKey:row.runtime_key,checksum:row.manifest_sha256,terminalId:row.terminal_id}}
const aad=(src:Source,storeId:string)=>JSON.stringify({kind:'spaceverse-pos-proxy-v2',...src,storeId})
const canonical=(src:Source,storeId:string,deviceKey:string,revision:number)=>JSON.stringify({src,storeId,deviceKey,revision})
function key(row:ProxyRow){
 const value=onboardingSecretBox().decrypt({keyId:row.secret_key_id,nonce:row.secret_nonce,ciphertext:row.secret_ciphertext,authTag:row.secret_auth_tag},aad(sourceOf(row),row.store_id))
 if(!POS_DEVICE_KEY_PATTERN.test(value))throw unavailable()
 return value
}
async function gate(admin:AdminPrincipal,write=false){
 await requireOnboardingAccess(admin,write)
 if(!config.enableOnboardingPosProxy||!config.enableOnboardingWorkflow)throw new HttpError(403,'ONBOARDING_POS_PROXY_DISABLED','Проверка кассы через прокси пока выключена.')
 const ready=await pool.query<{ready:boolean}>("SELECT to_regclass('public.admin_onboarding_pos_proxy') IS NOT NULL AS ready")
 if(!ready.rows[0]?.ready)throw unavailable()
}
async function source(client:Pick<PoolClient,'query'>,admin:AdminPrincipal,draftId:string,lock=false):Promise<Source>{
 const owned=await loadOwnedOnboardingRuntimeSource(client,admin,draftId,lock)
 const terminal=(await client.query<{terminal_id:string}>('SELECT terminal_id FROM admin_onboarding_progress WHERE draft_id=$1::uuid',[owned.draftId])).rows[0]?.terminal_id??''
 return {draftId:owned.draftId,companyId:owned.manifest.scope.companyId,venueId:owned.manifest.scope.venueId,
  runtimeKey:owned.manifest.runtimeKey,checksum:owned.manifest.manifestSha256,terminalId:terminal}
}
async function row(client:Pick<PoolClient,'query'>,draftId:string,lock=false){
 return (await client.query<ProxyRow>(`SELECT ${columns} FROM admin_onboarding_pos_proxy WHERE draft_id=$1::uuid${lock?' FOR UPDATE':''}`,[draftId])).rows[0]
}
const advice:Record<string,string>&{configuration_changed:string;verifying:string}={
 not_configured:'Сохраните ID терминала, магазин и ключ устройства. Адрес подключения выбирает сервер.',
 not_verified:'Нажмите «Проверить связь». Проверка сама не создаёт событие кассы.',
 proxy_not_registered:'Приложение ещё не подключено к серверному прокси. Продолжите развёртывание и вернитесь к проверке.',
 proxy_unavailable:'Сервер заведения не ответил. Проверьте его запуск и повторите проверку.',
 proxy_response_invalid:'Прокси не подтвердил устройство и область. Проверьте настройку прокси v2 и повторите проверку.',
 device_key_rejected:'Ключ устройства отозван или относится к другой точке. Получите правильный X-Pivnik-Device-Key.',
 terminal_event_missing:'С кассы ещё не пришло тестовое событие. Отправьте его с терминала через настроенный прокси v2 и повторите проверку.',
 terminal_event_stale:'Последнее тестовое событие старше пяти минут. Отправьте новое событие с кассы.',
 provider_data_pending:'Касса ответила, но полная загрузка документов провайдера ещё не подтверждена. Дождитесь её и повторите проверку.',
 confirmed:'Прокси, устройство, тестовое событие и состояние документов подтверждены. Запуск приложения проверяется отдельно.',
 configuration_changed:'ID терминала или область изменились. Сохраните настройку прокси заново.',
 verifying:'Идёт проверка. Дождитесь результата или откройте сохранённое состояние.',
 verification_expired:'Предыдущая проверка не завершилась вовремя. Повторите её.',
 verification_stale:'Последняя успешная проверка старше пяти минут. Повторите проверку связи.',
}
function view(src:Source,stored?:ProxyRow){
 let status=stored?.status??'not_configured',code=stored?.last_code??'not_configured',report=stored?.report??emptyReport()
 if(stored&&!matches(stored,src)){status='pending';code='configuration_changed';report=emptyReport()}
 else if(stored?.status==='verifying'){code=stored.lease_active?'verifying':'verification_expired';status=stored.lease_active?'verifying':'degraded';report=emptyReport()}
 else if(stored?.status==='active'&&(!stored.checked_at||Date.now()-Date.parse(stored.checked_at)>POS_EVENT_FRESH_MS)){status='degraded';code='verification_stale';report=emptyReport()}
 return {draftId:src.draftId,provider:'evotor',transport:'proxy_v2',revision:stored?.revision??0,status,code,nextAction:advice[code]??'Повторите проверку подключения.',
  storeId:stored?.store_id??'',terminalId:src.terminalId,credential:{present:Boolean(stored),masked:stored?'••••••••':null},
  checkedAt:stored?.checked_at??null,lastDeviceActivityAt:stored?.last_device_event_at??null,report,
  runtimeStatus:'not_provisioned',published:false}
}
export type OnboardingPosProxyView=ReturnType<typeof view>
export async function loadOnboardingPosProxyProjection(client:Pick<PoolClient,'query'>,admin:AdminPrincipal,draftId:string){
 if(!config.enableOnboardingPosProxy)return null
 const ready=await client.query<{ready:boolean}>("SELECT to_regclass('public.admin_onboarding_pos_proxy') IS NOT NULL AS ready")
 if(!ready.rows[0]?.ready)throw unavailable()
 const src=await source(client,admin,draftId),stored=await row(client,src.draftId)
 return view(src,stored)
}
export async function getOnboardingPosProxy(admin:AdminPrincipal,draftId:string){
 await gate(admin)
 try{const src=await source(pool,admin,draftId),stored=await row(pool,src.draftId);if(stored)key(stored);return view(src,stored)}
 catch(error){if(error instanceof HttpError)throw error;throw unavailable()}
}
export async function saveOnboardingPosProxy(admin:AdminPrincipal,draftId:string,raw:unknown){
 await gate(admin,true);const input=command(raw),client=await pool.connect().catch(()=>{throw unavailable()})
 try{
  await client.query('BEGIN');const src=await source(client,admin,draftId,true)
  if(!src.terminalId)throw new HttpError(409,'ONBOARDING_TERMINAL_REQUIRED','Сначала сохраните ID терминала в шагах подключения.')
  const before=await row(client,src.draftId,true),box=onboardingSecretBox()
  if(before?.request_key===input.requestKey){
   if(!matches(before,src)||before.store_id!==input.storeId||key(before)!==input.deviceKey
     ||!box.matchesFingerprint(before.request_fingerprint,box.fingerprint(before.secret_key_id,canonical(src,input.storeId,input.deviceKey,input.revision))))throw new HttpError(409,'ONBOARDING_PROXY_REQUEST_CONFLICT','Этот запрос уже использован с другими данными.')
   await client.query('COMMIT');return view(src,before)
  }
  if((before?.revision??0)!==input.revision)throw new HttpError(409,'ONBOARDING_PROXY_REVISION_CONFLICT','Настройка изменилась. Откройте сохранённую версию.')
  if(before?.lease_active)throw new HttpError(409,'ONBOARDING_PROXY_VERIFYING','Дождитесь текущей проверки перед заменой ключа.')
  const encrypted=box.encrypt(input.deviceKey,aad(src,input.storeId))
  await client.query(`INSERT INTO admin_onboarding_pos_proxy(draft_id,company_id,venue_id,runtime_key,manifest_sha256,
    store_id,terminal_id,secret_key_id,secret_nonce,secret_ciphertext,secret_auth_tag,request_key,request_revision,request_fingerprint)
    VALUES($1::uuid,$2::bigint,$3::bigint,$4,$5,$6,$7,$8,$9,$10,$11,$12::uuid,$13,$14)
    ON CONFLICT(draft_id) DO UPDATE SET company_id=EXCLUDED.company_id,venue_id=EXCLUDED.venue_id,
    runtime_key=EXCLUDED.runtime_key,manifest_sha256=EXCLUDED.manifest_sha256,store_id=EXCLUDED.store_id,
    terminal_id=EXCLUDED.terminal_id,secret_key_id=EXCLUDED.secret_key_id,secret_nonce=EXCLUDED.secret_nonce,
    secret_ciphertext=EXCLUDED.secret_ciphertext,secret_auth_tag=EXCLUDED.secret_auth_tag,request_key=EXCLUDED.request_key,
    request_revision=EXCLUDED.request_revision,request_fingerprint=EXCLUDED.request_fingerprint,
    revision=admin_onboarding_pos_proxy.revision+1,status='pending',last_code='not_verified',lease_token=NULL,
    lease_expires_at=NULL,checked_at=NULL,verified_at=NULL,last_device_event_at=NULL,report=NULL,updated_at=NOW()`,
   [src.draftId,src.companyId,src.venueId,src.runtimeKey,src.checksum,input.storeId,src.terminalId,
    encrypted.keyId,encrypted.nonce,encrypted.ciphertext,encrypted.authTag,input.requestKey,input.revision,
    box.fingerprint(encrypted.keyId,canonical(src,input.storeId,input.deviceKey,input.revision))])
  await recordAudit({admin,action:'onboarding.pos_proxy_save',entityType:'onboarding_draft',entityId:src.draftId,
   before:{revision:before?.revision??0},after:{revision:(before?.revision??0)+1},metadata:{transport:'proxy_v2'}},client)
  const saved=await row(client,src.draftId);await client.query('COMMIT');return view(src,saved)
 }catch(error){await client.query('ROLLBACK').catch(()=>undefined);if(error instanceof HttpError)throw error;throw unavailable()}finally{client.release()}
}
export async function verifyOnboardingPosProxy(admin:AdminPrincipal,draftId:string,raw:unknown){
 await gate(admin,true)
 if(Object.keys(exact(raw,[])).length)throw invalid()
 const lease=crypto.randomUUID(),client=await pool.connect().catch(()=>{throw unavailable()})
 let src:Source,claimed:ProxyRow,deviceKey:string
 try{
  await client.query('BEGIN');src=await source(client,admin,draftId,true)
  const stored=await row(client,src.draftId,true)
  if(!stored)throw new HttpError(409,'ONBOARDING_PROXY_REQUIRED','Сначала сохраните ключ устройства.')
  if(!matches(stored,src))throw new HttpError(409,'ONBOARDING_PROXY_CONFIGURATION_CHANGED',advice.configuration_changed)
  if(stored.lease_active)throw new HttpError(409,'ONBOARDING_PROXY_VERIFYING',advice.verifying)
  deviceKey=key(stored)
  await client.query(`UPDATE admin_onboarding_pos_proxy SET status='verifying',last_code='verifying',
    lease_token=$2::uuid,lease_expires_at=NOW()+INTERVAL '30 seconds',revision=revision+1,report=NULL,updated_at=NOW()
    WHERE draft_id=$1::uuid`,[src.draftId,lease])
  claimed=(await row(client,src.draftId))!
  await recordAudit({admin,action:'onboarding.pos_proxy_verify_start',entityType:'onboarding_draft',entityId:src.draftId,
    after:{revision:claimed.revision,status:'verifying'}},client)
  await client.query('COMMIT')
 }catch(error){await client.query('ROLLBACK').catch(()=>undefined);if(error instanceof HttpError)throw error;throw unavailable()}finally{client.release()}
 let code='proxy_unavailable',report=emptyReport(),lastEventAt:string|null=null
 try{
  const origin=resolveOnboardingProxyOrigin(src.runtimeKey)
  if(!origin)code='proxy_not_registered'
  else{
   const url=new URL('/api/device/pos/onboarding/status',origin);url.searchParams.set('challenge',lease)
   const response=await fetch(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15_000),headers:{'X-Pivnik-Device-Key':deviceKey,Accept:'application/json'}})
   if(response.status===401||response.status===403)code='device_key_rejected'
   else if(!response.ok)code='proxy_unavailable'
   else{
    const rawPacket=await packetBody(response)
    const packet=verifyPosOnboardingPacket(rawPacket,deviceKey,{challenge:lease,runtimeKey:src.runtimeKey,checksum:src.checksum,
      companyId:src.companyId,venueId:src.venueId,terminalId:src.terminalId,storeId:claimed.store_id})
    lastEventAt=packet.lastEvent?.receivedAt??null
    code=!packet.lastEvent?'terminal_event_missing':Date.now()-Date.parse(packet.lastEvent.receivedAt)>POS_EVENT_FRESH_MS?'terminal_event_stale':
      packet.report.state!=='available'?'provider_data_pending':'confirmed'
    if(code==='confirmed')report={state:'available',empty:packet.report.empty,netCents:packet.report.empty?'0':null,
      receiptCount:packet.report.empty?0:null,period:packet.report.period}
   }
  }
 }catch(error){code=(error as {code?:string;message?:string})?.code==='proxy_response_invalid'||(error as Error)?.message==='proxy_response_invalid'?'proxy_response_invalid':'proxy_unavailable'}
 const finish=await pool.connect().catch(()=>{throw unavailable()})
 try{
  await finish.query('BEGIN');const currentSource=await source(finish,admin,draftId,true),current=await row(finish,src.draftId,true)
  if(!current||!current.lease_active||current.lease_token!==lease||current.revision!==claimed.revision||!matches(current,currentSource))throw new HttpError(409,'ONBOARDING_PROXY_CONFIGURATION_CHANGED',advice.configuration_changed)
  const status=code==='confirmed'?'active':['proxy_not_registered','terminal_event_missing','provider_data_pending'].includes(code)?'pending':current.verified_at?'degraded':'failed'
  const box=onboardingSecretBox(),wrapped=box.encrypt(deviceKey,aad(src,current.store_id))
  await finish.query(`UPDATE admin_onboarding_pos_proxy SET status=$2,last_code=$3,lease_token=NULL,lease_expires_at=NULL,
    checked_at=NOW(),verified_at=CASE WHEN $2='active' THEN NOW() ELSE verified_at END,last_device_event_at=$4::timestamptz,
    report=$5::jsonb,secret_key_id=$6,secret_nonce=$7,secret_ciphertext=$8,secret_auth_tag=$9,request_fingerprint=$10,
    revision=revision+1,updated_at=NOW() WHERE draft_id=$1::uuid`,
   [src.draftId,status,code,lastEventAt,JSON.stringify(report),wrapped.keyId,wrapped.nonce,wrapped.ciphertext,wrapped.authTag,
    box.fingerprint(wrapped.keyId,canonical(src,current.store_id,deviceKey,current.request_revision))])
  await recordAudit({admin,action:'onboarding.pos_proxy_verify_finish',entityType:'onboarding_draft',entityId:src.draftId,
    after:{status,code},metadata:{reportState:report.state}},finish)
  const saved=await row(finish,src.draftId);await finish.query('COMMIT');return view(currentSource,saved)
 }catch(error){await finish.query('ROLLBACK').catch(()=>undefined);if(error instanceof HttpError)throw error;throw unavailable()}finally{finish.release()}
}
