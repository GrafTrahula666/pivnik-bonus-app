import {useCallback,useEffect,useRef,useState} from 'react'
import {apiGet,apiPost,ApiError} from '../api'
import type {Scope} from './tenant-crm-contract'

interface Props {actorId:string;draftId:string;scope:Scope}
interface Check {
  activationStatus:'pending'|'verifying'|'failed'
  nextAction:string
  operation:{status:'not_started'|'running'|'action_required'|'retryable_error';attemptCount:number;startAllowed:boolean;updatedAt:string|null}
}
function checked(raw:unknown,draftId:string,companyId:string,venueId:string):Check{
  if(!raw||typeof raw!=='object')throw new Error('Invalid CRM check')
  const value=raw as Record<string,unknown>,scope=value.scope as Scope|undefined
  const operation=value.operation as Record<string,unknown>|undefined
  if(value.schemaVersion!==1||value.activationAllowed!==false||value.crmStatus!=='not_provisioned'||value.guestApplicationRequired!==false||
    !scope||scope.companyId!==companyId||scope.venueId!==venueId||
    !['pending','verifying','failed'].includes(String(value.activationStatus))||
    typeof value.nextAction!=='string'||!value.nextAction.trim()||value.nextAction.length>1000||
    !operation||operation.draftId!==draftId||operation.step!=='crm_activation_check'||operation.result!==null||
    !['not_started','running','action_required','retryable_error'].includes(String(operation.status))||
    !Number.isSafeInteger(operation.attemptCount)||Number(operation.attemptCount)<0||typeof operation.startAllowed!=='boolean'||
    (operation.updatedAt!==null&&(typeof operation.updatedAt!=='string'||!Number.isFinite(Date.parse(operation.updatedAt)))))throw new Error('Unverified CRM activation')
  const storedScope=operation.scope as Scope|undefined
  if(storedScope?.companyId!==companyId||storedScope.venueId!==venueId)throw new Error('Invalid CRM check scope')
  return {activationStatus:value.activationStatus as Check['activationStatus'],nextAction:value.nextAction,operation:operation as unknown as Check['operation']}
}
function failure(error:unknown){
  if(error instanceof ApiError){
    if(error.status===401)return 'Сессия истекла. Войдите снова.'
    if(error.status===403||error.status===404)return 'Проверка запуска недоступна или у вас нет доступа к заведению.'
    if(error.status===429)return 'Слишком частые проверки. Повторите через минуту.'
    if(error.code==='ONBOARDING_PROVISIONING_DEPENDENCY_REQUIRED')return 'Сначала завершите подготовку схемы клиентской базы в мастере.'
  }
  return 'Результат проверки не подтверждён. Обновите состояние перед повторной попыткой.'
}
export function TenantCrmActivationCheck(props:Props){
  return <ActivationCheck key={`${props.actorId}:${props.draftId}:${props.scope.companyId}:${props.scope.venueId}`} {...props}/>
}
function ActivationCheck({draftId,scope:{companyId,venueId}}:Props){
  const [result,setResult]=useState<Check|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(true)
  const generation=useRef(0),inFlight=useRef(false)
  const request=useCallback(async(run=false)=>{
    if(inFlight.current)return
    inFlight.current=true
    const current=++generation.current
    setBusy(true);setResult(null);setError('')
    const path=`/api/admin/onboarding/drafts/${encodeURIComponent(draftId)}/crm/activation-check`
    try{
      const value=checked(await (run?apiPost(path,{}):apiGet(path)),draftId,companyId,venueId)
      if(current===generation.current)setResult(value)
    }catch(error){if(current===generation.current)setError(failure(error))}
    finally{if(current===generation.current){inFlight.current=false;setBusy(false)}}
  },[draftId,companyId,venueId])
  const invalidate=useCallback(()=>{generation.current++;inFlight.current=false},[])
  useEffect(()=>{
    void request()
    return invalidate
  },[request,invalidate])
  return <section className="tenant-crm" aria-label="Проверка запуска CRM" aria-busy={busy}>
    <h3>Запуск CRM</h3>
    <p>Для CRM-сайта гостевое приложение не обязательно. Проверка сама не включает заведение и не оформляет подписку.</p>
    <div className="onboarding-actions">
      <button className="btn secondary" type="button" disabled={busy||!result?.operation.startAllowed} onClick={()=>void request(true)}>Проверить запуск CRM</button>
      <button className="btn secondary" type="button" disabled={busy} onClick={()=>void request()}>Обновить состояние запуска</button>
    </div>
    {busy&&<p role="status">Проверяем состояние запуска…</p>}
    {error&&<p role="alert">{error}</p>}
    {result&&<>
      <p role="status">{result.activationStatus==='verifying'?'Проверка выполняется. CRM ещё не запущена.':
        result.activationStatus==='failed'?'Проверка не пройдена. CRM ещё не запущена.':'CRM ещё не запущена.'}</p>
      <p>{result.nextAction}</p>
      <p>Попыток проверки: {result.operation.attemptCount}</p>
      {result.operation.updatedAt&&<small>Состояние сохранено: {new Date(result.operation.updatedAt).toLocaleString('ru-RU')}</small>}
    </>}
  </section>
}
