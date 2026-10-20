import {useCallback,useEffect,useRef,useState} from 'react'
import {apiGet,apiPost,ApiError} from '../api'
import type {Scope} from './tenant-crm-contract'

const topics={connection:'Не получается подключить кассу',customer_data:'Не вижу клиентские данные',access:'Нужна помощь с доступом',activation:'Не получается запустить CRM'}
type Topic=keyof typeof topics
interface Ticket {id:string;draftId:string;topic:Topic;status:'recorded';createdAt:string}
function tickets(raw:unknown,draftId:string,scope:Scope):Ticket[]{
  const value=raw as {schemaVersion?:unknown;draftId?:unknown;scope?:Scope;delivery?:unknown;externalNotificationSent?:unknown;requests?:unknown}
  if(!value||value.schemaVersion!==1||value.draftId!==draftId||value.scope?.companyId!==scope.companyId||value.scope.venueId!==scope.venueId||
    value.delivery!=='internal_queue'||value.externalNotificationSent!==false||!Array.isArray(value.requests)||value.requests.length>4)throw new Error('Unconfirmed support')
  const seen=new Set<string>()
  return value.requests.map((row:Ticket)=>{
    if(!row||row.draftId!==draftId||row.status!=='recorded'||!Object.hasOwn(topics,row.topic)||seen.has(row.topic)||
      typeof row.id!=='string'||!/^[0-9a-f-]{36}$/.test(row.id)||typeof row.createdAt!=='string'||!Number.isFinite(Date.parse(row.createdAt)))throw new Error('Unconfirmed ticket')
    seen.add(row.topic);return row
  })
}
function failure(error:unknown){
  if(error instanceof ApiError){
    if(error.status===401)return 'Сессия истекла. Войдите снова.'
    if(error.status===403||error.status===404)return 'Обращения недоступны или доступ к заведению отозван.'
    if(error.status===429)return 'Слишком много запросов. Повторите через минуту.'
  }
  return 'Сохранение не подтверждено. Обновите обращения перед повтором.'
}
export function OnboardingSupport(props:{actorId:string;draftId:string;scope:Scope}){
  return <Support key={`${props.actorId}:${props.draftId}:${props.scope.companyId}:${props.scope.venueId}`} {...props}/>
}
function Support({draftId,scope}:{draftId:string;scope:Scope}){
  const [result,setResult]=useState<Ticket[]|null>(null),[topic,setTopic]=useState<Topic>('connection')
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const sequence=useRef(0),inFlight=useRef(false)
  const companyId=scope.companyId,venueId=scope.venueId
  const load=useCallback(async(selected?:Topic)=>{
    if(inFlight.current)return
    inFlight.current=true;const current=++sequence.current
    setBusy(true);setResult(null);setError('')
    const path=`/api/admin/onboarding/drafts/${encodeURIComponent(draftId)}/support`
    try{
      const value=tickets(await (selected?apiPost(path,{topic:selected}):apiGet(path)),draftId,{companyId,venueId})
      if(current===sequence.current)setResult(value)
    }catch(error){if(current===sequence.current)setError(failure(error))}
    finally{if(current===sequence.current){inFlight.current=false;setBusy(false)}}
  },[draftId,companyId,venueId])
  const invalidate=useCallback(()=>{sequence.current++;inFlight.current=false},[])
  useEffect(()=>{void load();return invalidate},[load,invalidate])
  return <section className="tenant-crm" aria-label="Помощь с подключением" aria-busy={busy}>
    <h3>Помощь с подключением</h3>
    <p>Выберите проблему. Обращение сохранится в панели и будет доступно оператору платформы. Повтор той же причины не создаёт дубль.</p>
    <p>Сохранение не означает, что обращение уже прочитали. Уведомления по почте и в мессенджеры не отправляются.</p>
    <label className="field"><span>Причина обращения</span><select value={topic} disabled={busy} onChange={event=>setTopic(event.target.value as Topic)}>
      {Object.entries(topics).map(([key,label])=><option key={key} value={key}>{label}</option>)}
    </select></label>
    <div className="onboarding-actions">
      <button className="btn secondary" type="button" disabled={busy||result===null} onClick={()=>void load(topic)}>Сохранить обращение</button>
      <button className="btn secondary" type="button" disabled={busy} onClick={()=>void load()}>Обновить обращения</button>
    </div>
    {busy&&<p role="status">Проверяем обращения…</p>}
    {error&&<p role="alert">{error}</p>}
    {result&&<>{result.length===0?<p>Сохранённых обращений пока нет.</p>:<ul>{result.map(row=><li key={row.id}>
      <b>{topics[row.topic]}</b><p>Номер обращения: <span className="support-reference">{row.id}</span></p>
      <p>Сохранено в панели · прочтение не подтверждено</p><small>{new Date(row.createdAt).toLocaleString('ru-RU')}</small>
    </li>)}</ul>}</>}
  </section>
}
