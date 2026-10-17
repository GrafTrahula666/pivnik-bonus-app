import {useCallback,useEffect,useRef,useState} from 'react'
import {ApiError,apiGet,apiPost,apiPut} from '../api'

const labels={not_configured:'Не настроено',pending:'Ожидает подключения',verifying:'Проверяется',active:'Связь подтверждена',degraded:'Требует внимания',suspended:'Приостановлено',failed:'Ошибка проверки'}
interface ProxyState{
 draftId:string;transport:'proxy_v2';revision:number;status:keyof typeof labels;code:string;nextAction:string
 storeId:string;terminalId:string;credential:{present:boolean;masked:string|null}
 checkedAt:string|null;lastDeviceActivityAt:string|null;runtimeStatus:'not_provisioned';published:false
 report:{state:'available'|'unavailable';empty:boolean|null;netCents:string|null;receiptCount:number|null}
}
interface Command{requestKey:string;revision:number;storeId:string;deviceKey:string}
function confirmed(raw:ProxyState,draftId:string){
 if(!raw||raw.draftId!==draftId||raw.transport!=='proxy_v2'||raw.runtimeStatus!=='not_provisioned'||raw.published!==false
  ||!Number.isSafeInteger(raw.revision)||!Object.hasOwn(labels,raw.status)||typeof raw.nextAction!=='string'
  ||!raw.credential||!raw.report||!['available','unavailable'].includes(raw.report.state)
  ||(raw.status==='active'&&(raw.report.state!=='available'||!raw.lastDeviceActivityAt))
  ||(raw.report.state==='unavailable'&&(raw.report.netCents!==null||raw.report.receiptCount!==null)))throw new Error('Результат проверки не подтверждён. Откройте сохранённую настройку.')
 return raw
}
export function OnboardingPosProxy({draftId,canWrite,refreshKey,onChanged}:{draftId:string;canWrite:boolean;refreshKey:string;onChanged:()=>void}){
 const [saved,setSaved]=useState<ProxyState|null>(null),[storeId,setStoreId]=useState(''),[deviceKey,setDeviceKey]=useState('')
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[uncertain,setUncertain]=useState(false)
 const command=useRef<Command|null>(null),inFlight=useRef(false),dirty=useRef(false),sequence=useRef(0)
 const path='/api/admin/onboarding/drafts/'+draftId+'/integrations/pos-proxy'
 const load=useCallback(async()=>{
  const run=++sequence.current;setError('')
  try{const value=confirmed(await apiGet<ProxyState>(path),draftId)
   if(run!==sequence.current)return
   setSaved(value);setStoreId(value.storeId);setDeviceKey('');command.current=null;setUncertain(false);dirty.current=false
  }catch(error){if(run===sequence.current)setError(error instanceof Error?error.message:'Не удалось загрузить подключение.')}
 },[path,draftId])
 useEffect(()=>{
  const counter=sequence
  if(!dirty.current&&!command.current&&!inFlight.current)void load()
  return()=>{counter.current++}
 },[load,refreshKey])
 async function save(){
  if(!canWrite||!saved||inFlight.current)return
  const input=command.current??{requestKey:crypto.randomUUID(),revision:saved.revision,storeId,deviceKey}
  command.current=input;inFlight.current=true;sequence.current++;setBusy(true);setError('');setNotice('')
  try{const value=confirmed(await apiPut<ProxyState>(path,input),draftId)
   setSaved(value);setStoreId(value.storeId);setDeviceKey('');command.current=null;setUncertain(false);dirty.current=false
   setNotice('Ключ сохранён. Связь ещё не проверена.');onChanged()
  }catch(error){setError(error instanceof Error?error.message:'Результат сохранения неизвестен. Повторите тот же запрос.')
   if(error instanceof ApiError&&error.status>=400&&error.status<500&&error.status!==408){command.current=null;setUncertain(false)}else setUncertain(true)
  }finally{inFlight.current=false;setBusy(false)}
 }
 async function verify(){
  if(!canWrite||!saved?.credential.present||dirty.current||inFlight.current||command.current)return
  inFlight.current=true;sequence.current++;setBusy(true);setError('');setNotice('')
  try{setSaved(confirmed(await apiPost<ProxyState>(path+'/verify',{}),draftId));onChanged()}
  catch(error){setError(error instanceof Error?error.message:'Откройте сохранённое состояние перед повторной проверкой.');void load()}
  finally{inFlight.current=false;setBusy(false)}
 }
 return <section className="onboarding-integration" aria-label="Связь с кассой через прокси">
  <div className="onboarding-step"><b>Эвотор · прокси v2</b><span>{saved?labels[saved.status]:'Загружаем…'}</span></div>
  <p>Проверяем зарегистрированное устройство, тестовое событие и загрузку документов провайдера. Отправьте событие с терминала; эта кнопка его не создаёт.</p>
  {saved&&<><p>{saved.nextAction}</p><p>ID терминала: {saved.terminalId||'Сначала сохраните в шагах подключения'}</p>
   {saved.checkedAt&&<p>Проверено: {new Date(saved.checkedAt).toLocaleString('ru-RU')}</p>}
   {saved.lastDeviceActivityAt&&<p>Событие кассы: {new Date(saved.lastDeviceActivityAt).toLocaleString('ru-RU')}</p>}
   <p>{saved.report.state==='unavailable'?'Отчёт недоступен · сумма неизвестна':saved.report.empty?'0 ₽ · 0 чеков · данные получены за проверенный период':'Данные получены · суммы доступны в отчётах после запуска'}</p>
  </>}
  <form onSubmit={event=>{event.preventDefault();void save()}}>
   <fieldset className="onboarding-fields" disabled={!canWrite||busy||!saved||uncertain} onChange={()=>{dirty.current=true;sequence.current++}}>
    <label className="field"><span>Магазин прокси</span><input aria-label="Магазин прокси" autoComplete="off" maxLength={200} value={storeId} onChange={event=>setStoreId(event.target.value)}/></label>
    <label className="field"><span>Ключ устройства</span><input aria-label="Ключ устройства прокси" aria-describedby={'proxy-key-'+draftId} type="password" autoComplete="new-password" maxLength={49} value={deviceKey} onChange={event=>setDeviceKey(event.target.value)}/><small id={'proxy-key-'+draftId}>X-Pivnik-Device-Key. {saved?.credential.present?'Сохранён: ••••••••.':''} Ключ хранится на сервере в зашифрованном виде.</small></label>
   </fieldset>
   <div className="onboarding-actions">
    {canWrite&&<><button className="btn" disabled={busy||!saved||(!uncertain&&(!storeId||!deviceKey))}>{busy?'Выполняем…':uncertain?'Повторить сохранение ключа':'Сохранить ключ устройства'}</button>
     <button className="btn secondary" type="button" disabled={busy||!saved?.credential.present||dirty.current||uncertain||saved.status==='verifying'} onClick={()=>void verify()}>Проверить связь</button></>}
    <button className="btn secondary" type="button" disabled={busy} onClick={()=>void load()}>Открыть настройку прокси</button>
   </div>
  </form>
  {error&&<p className="onboarding-feedback error" role="alert">{error}</p>}{notice&&<p className="onboarding-feedback" role="status">{notice}</p>}
 </section>
}
