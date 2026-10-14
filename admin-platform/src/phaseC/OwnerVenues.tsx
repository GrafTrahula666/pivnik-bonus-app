import {useCallback,useEffect,useRef,useState} from 'react'
import {apiGet} from '../api'
const statuses={not_configured:'Не настроено',pending:'Ожидает подключения',verifying:'Проверяется',active:'Активно',degraded:'Требует внимания',suspended:'Приостановлено',failed:'Ошибка'}
interface Venue{
 kind:'draft'|'existing';id:string;venueId:string|null;companyName:string;name:string
 status:keyof typeof statuses;requiresAttention:boolean;attentionCode:string;nextAction:string
 lastOperatorActivityAt:string|null;lastDeviceActivityAt:string|null;currentStep:string|null
 report:{state:'available'|'unavailable';netCents:string|null;receiptCount:number|null}
}
interface Page{venues:Venue[];total:number;nextOffset:number|null}
function DeveloperRequest({venue}:{venue:Venue}){
 const [message,setMessage]=useState(''),[notice,setNotice]=useState('')
 const diagnostic=['SPACEVERSE · помощь с подключением','Организация: '+venue.companyName,'Заведение: '+venue.name,
  (venue.kind==='draft'?'ID подключения: ':'ID точки: ')+venue.id,'Статус: '+statuses[venue.status],
  'Код состояния: '+venue.attentionCode,'Следующий шаг: '+venue.nextAction,
  'Событие устройства: '+(venue.lastDeviceActivityAt??'не подтверждено'),'Настройка: '+(venue.lastOperatorActivityAt??'не подтверждена')].join('\n')
 const text=(message?message+'\n\n':'')+diagnostic
 async function copy(){
  try{await navigator.clipboard.writeText(text);setNotice('Обращение скопировано. Передайте его вашему разработчику.')}catch{setNotice('Не удалось скопировать автоматически. Выделите и скопируйте текст обращения.')}
 }
 return <details className="owner-venue-support"><summary>Нужна помощь разработчика?</summary>
  <label className="field"><span>Что не получается</span><textarea aria-label="Что не получается" maxLength={1000} value={message} onChange={event=>{setMessage(event.target.value);setNotice('')}} placeholder="Опишите проблему без паролей и ключей"/></label>
  <label className="field"><span>Текст обращения</span><textarea aria-label="Текст обращения" readOnly value={text} rows={5}/></label>
  <button className="btn secondary" type="button" onClick={()=>void copy()}>Скопировать обращение разработчику</button>
  <p>Передайте текст разработчику удобным для вас способом. Из панели обращение автоматически не отправляется.</p>
  {notice&&<p role="status">{notice}</p>}
 </details>
}
export function OwnerVenues({onDraft,onVenue,refreshKey}:{onDraft:(id:string)=>void;onVenue:(id:string)=>void;refreshKey:string}){
 const [result,setResult]=useState<Page|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const sequence=useRef(0)
 const load=useCallback(async(offset=0)=>{
  const run=++sequence.current;setBusy(true);setError('')
  try{const value=await apiGet<Page>('/api/admin/onboarding/venues?offset='+offset)
   if(run!==sequence.current)return
   if(!Array.isArray(value.venues)||value.venues.some(venue=>!Object.hasOwn(statuses,venue.status)))throw new Error('Сервер не подтвердил состояния заведений.')
   setResult(before=>({...value,venues:offset&&before?[...before.venues,...value.venues].filter((venue,index,rows)=>rows.findIndex(row=>row.kind===venue.kind&&row.id===venue.id)===index):value.venues}))
  }catch(error){if(run===sequence.current){setResult(null);setError(error instanceof Error?error.message:'Не удалось загрузить состояния.')}}
  finally{if(run===sequence.current)setBusy(false)}
 },[])
 useEffect(()=>{void load();const counter=sequence;return()=>{counter.current++}},[load,refreshKey])
 useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==='visible')void load()},60_000);return()=>clearInterval(timer)},[load])
 const date=(value:string|null)=>value?new Date(value).toLocaleString('ru-RU'):'Нет подтверждённой активности'
 return <section className="card owner-venues" aria-label="Все заведения">
  <div className="onboarding-head"><div><span className="eyebrow">МОЯ СЕТЬ</span><h2>Заведения</h2><p>Статус подключения, последняя активность и следующий шаг.</p></div><button className="btn secondary" disabled={busy} onClick={()=>void load()}>Обновить заведения</button></div>
  {error&&<p className="onboarding-feedback error" role="alert">{error}</p>}
  {busy&&<p role="status">Получаем состояния заведений…</p>}
  {result&&<><p>Показано {result.venues.length} из {result.total}</p>
   {!result.venues.length&&<p>Заведений пока нет. Создайте заведение в мастере или примите приглашение.</p>}
   <ul className="owner-venue-list">{result.venues.map(venue=><li key={venue.kind+':'+venue.id} data-status={venue.status}>
    <div className="owner-venue-title"><div><b>{venue.name}</b><small>{venue.companyName}</small></div><span>{statuses[venue.status]}</span></div>
    {venue.requiresAttention&&<p className="onboarding-note"><b>Требует внимания: </b>{venue.nextAction}</p>}
    <dl><div><dt>Последнее событие устройства</dt><dd>{date(venue.lastDeviceActivityAt)}</dd></div><div><dt>Изменение настройки</dt><dd>{date(venue.lastOperatorActivityAt)}</dd></div></dl>
    <p>{venue.report.state==='unavailable'?'Отчёт недоступен · сумма неизвестна':venue.report.receiptCount===0?'0 ₽ · 0 чеков · данные получены':'Данные получены · откройте отчёты для просмотра сумм'}</p>
    <button className="btn secondary" onClick={()=>venue.kind==='draft'?onDraft(venue.id):onVenue(venue.venueId!)}>{venue.kind==='draft'?'Продолжить подключение':'Открыть заведение'}</button>
    <DeveloperRequest venue={venue}/>
   </li>)}</ul>
   {result.nextOffset!==null&&<button className="btn secondary" disabled={busy} onClick={()=>void load(result.nextOffset!)}>Показать ещё заведения</button>}
  </>}
 </section>
}
