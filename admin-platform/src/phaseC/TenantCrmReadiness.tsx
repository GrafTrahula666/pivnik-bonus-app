import {useState} from 'react'
import {apiGet,ApiError} from '../api'
import {formatExact,verifiedEnvelope,type Scope} from './tenant-crm-contract'

interface Props {actorId:string;draftId:string;scope:Scope}
type Status='not_configured'|'pending'|'verifying'|'active'|'degraded'|'suspended'|'failed'
interface Check {id:string;status:Status;nextAction:string;checkedAt:string|null;customerCount?:string;dataState?:'empty'|'available'}
const names:Record<string,string>={customer_data:'Клиентские данные',provider:'Связь с кассой',subscription:'Подписка',activation:'Запуск CRM'}
const statuses:Record<Status,string>={not_configured:'Не настроено',pending:'Ожидает подтверждения',verifying:'Проверяется',active:'Проверено',degraded:'Требует повторной проверки',suspended:'Приостановлено',failed:'Проверка не пройдена'}
function failure(error:unknown){
  if(error instanceof ApiError){
    if(error.status===401)return 'Сессия истекла. Войдите снова.'
    if(error.status===403||error.status===404)return 'Проверка недоступна или у вас нет доступа к этому заведению.'
    if(error.status===429)return 'Слишком частые проверки. Повторите через минуту.'
    if(error.code==='TENANT_CRM_SOURCE_NOT_CONFIGURED')return 'Клиентская база ещё не подключена. Завершите подготовку заведения в мастере.'
    if(error.code==='ONBOARDING_SECRET_KEY_UNAVAILABLE')return 'Защищённое хранилище ключа кассы недоступно. Повторите позже или обратитесь в поддержку.'
  }
  return 'Не удалось проверить готовность CRM. Проверьте подключение и повторите попытку.'
}
function checks(raw:unknown,scope:Scope):Check[]{
  const value=verifiedEnvelope(raw,scope)
  if(value.activationAllowed!==false||value.crmStatus!=='not_provisioned'||value.guestApplicationRequired!==false||
    !['pending','degraded','verifying','failed'].includes(String(value.status))||!Array.isArray(value.checks)||value.checks.length!==4)throw new Error('Invalid CRM readiness')
  const seen=new Set<string>()
  return value.checks.map((row:Record<string,unknown>)=>{
    if(!row||typeof row!=='object'||typeof row.id!=='string'||!Object.hasOwn(names,row.id)||seen.has(row.id)||
      typeof row.status!=='string'||!Object.hasOwn(statuses,row.status)||typeof row.nextAction!=='string'||!row.nextAction.trim()||row.nextAction.length>1000||
      (row.checkedAt!==null&&(typeof row.checkedAt!=='string'||!Number.isFinite(Date.parse(row.checkedAt)))))throw new Error('Invalid CRM check')
    seen.add(row.id)
    if(row.id==='customer_data'&&(row.status!=='active'||typeof row.customerCount!=='string'||!/^(0|[1-9]\d{0,18})$/.test(row.customerCount)||
      row.dataState!==(row.customerCount==='0'?'empty':'available')))throw new Error('Invalid CRM source')
    if((row.id==='subscription'&&row.status!=='not_configured')||(row.id==='activation'&&row.status!=='pending'))throw new Error('Unverified activation')
    return {id:row.id,status:row.status as Status,nextAction:row.nextAction,checkedAt:row.checkedAt as string|null,
      ...(row.id==='customer_data'?{customerCount:row.customerCount as string,dataState:row.dataState as 'empty'|'available'}:{})}
  })
}
export function TenantCrmReadiness(props:Props){
  return <Readiness key={`${props.actorId}:${props.draftId}:${props.scope.companyId}:${props.scope.venueId}`} {...props}/>
}
function Readiness({draftId,scope}:Props){
  const [result,setResult]=useState<Check[]|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  async function verify(){
    if(busy)return
    setBusy(true);setResult(null);setError('')
    try{setResult(checks(await apiGet(`/api/admin/onboarding/drafts/${encodeURIComponent(draftId)}/crm/readiness`),scope))}
    catch(error){setError(failure(error))}
    finally{setBusy(false)}
  }
  return <section className="tenant-crm" aria-label="Готовность CRM к запуску" aria-busy={busy}>
    <h3>Что осталось для запуска CRM</h3>
    <p>Проверьте клиентские данные, последнюю проверку кассы и готовность подписки.</p>
    <button className="btn secondary" type="button" disabled={busy} onClick={()=>void verify()}>{busy?'Проверяем готовность CRM…':'Проверить готовность CRM'}</button>
    {error&&<p role="alert">{error}</p>}
    {result&&<>
      <p role="status">CRM ещё не запущена. Ниже указано, что нужно завершить.</p>
      <ul className="tenant-crm-checks">{result.map(row=><li key={row.id}>
        <b>{names[row.id]}</b><span> · {statuses[row.status]}</span><p>{row.nextAction}</p>
        {row.customerCount!==undefined&&<p>{row.dataState==='empty'?'База доступна, клиентов пока нет.':'Клиентов в базе: '+formatExact(row.customerCount)+'.'}</p>}
        {row.checkedAt&&<small>Проверено: {new Date(row.checkedAt).toLocaleString('ru-RU')}</small>}
      </li>)}</ul>
    </>}
  </section>
}
