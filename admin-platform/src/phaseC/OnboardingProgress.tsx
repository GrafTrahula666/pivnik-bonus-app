import { useCallback,useEffect,useRef,useState } from 'react'
import { ApiError,apiGet,apiPut } from '../api'

const stepNames={organization:'Организация',venue:'Заведение',application:'Приложение',provider:'Касса / провайдер',terminal:'Терминал',modules:'Модули',provisioning:'Развёртывание',verification:'Проверка связи'}
type Step=keyof typeof stepNames
const statuses={not_configured:'Не настроено',pending:'Ожидает подключения',verifying:'Проверяется',active:'Подтверждено',degraded:'Требует внимания',suspended:'Приостановлено',failed:'Ошибка'}
interface Progress{currentStep:Step;terminal:{id:string;label:string};cashReports:boolean}
interface Workflow{
  draftId:string;revision:number;progress:Progress
  steps:{id:Step;status:keyof typeof statuses;code:string;nextAction:string}[]
  runtimeStatus:'not_provisioned';published:false
  report:{state:'unavailable'|'available';netCents:string|null;receiptCount:number|null;code:string}
}
export function OnboardingProgress({draftId,canWrite,refreshKey}:{draftId:string;canWrite:boolean;refreshKey:string}){
  const [saved,setSaved]=useState<Workflow|null>(null),[form,setForm]=useState<Progress|null>(null)
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const command=useRef<{revision:number;progress:Progress}|null>(null),inFlight=useRef(false)
  const dirty=useRef(false),sequence=useRef(0)
  const path='/api/admin/onboarding/drafts/'+draftId+'/progress'
  const load=useCallback(async()=>{
    const run=++sequence.current
    setError('')
    try{
      const value=await apiGet<Workflow>(path)
      if(run!==sequence.current)return
      if(value.draftId!==draftId||value.runtimeStatus!=='not_provisioned'||value.published!==false
        ||!Object.hasOwn(stepNames,value.progress.currentStep)||value.steps.length!==8
        ||value.steps.some(step=>!Object.hasOwn(stepNames,step.id)||!Object.hasOwn(statuses,step.status)))throw new Error('Сервер не подтвердил статусы шагов.')
      setSaved(value);setForm(value.progress);command.current=null;dirty.current=false
    }catch(error){setError(error instanceof Error?error.message:'Не удалось загрузить шаги.')}
  },[path,draftId])
  useEffect(()=>{
    const counter=sequence
    if(!dirty.current&&!command.current&&!inFlight.current)void load()
    return()=>{counter.current++}
  },[load,refreshKey])
  async function save(){
    if(!canWrite||!saved||!form||inFlight.current)return
    inFlight.current=true;setBusy(true);setError('');setNotice('')
    sequence.current++
    command.current??={revision:saved.revision,progress:structuredClone(form)}
    try{
      const value=await apiPut<Workflow>(path,command.current)
      if(value.draftId!==draftId||value.runtimeStatus!=='not_provisioned'||value.published!==false)throw new Error('Сохранение прогресса не подтверждено.')
      setSaved(value);setForm(value.progress);command.current=null;dirty.current=false;setNotice('Шаг, терминал и выбор модулей сохранены. Связь ещё не подтверждена.')
    }catch(error){
      setError(error instanceof Error?error.message:'Повторите сохранение прогресса.')
      if(error instanceof ApiError&&error.status>=400&&error.status<500&&error.status!==408)command.current=null
    }finally{inFlight.current=false;setBusy(false)}
  }
  return <section className="onboarding-progress" aria-label="Шаги подключения">
    <div className="onboarding-step"><b>Подключение заведения</b><span>Заведение ещё не запущено</span></div>
    {saved&&<><p>Продолжить: <b>{stepNames[saved.progress.currentStep]}</b></p>
      <ol className="onboarding-statuses">{saved.steps.map(step=><li key={step.id} data-status={step.status}>
        <div><b>{stepNames[step.id]}</b><span>{statuses[step.status]}</span></div><p>{step.nextAction}</p>
      </li>)}</ol>
      <p className="onboarding-note">{saved.report.state==='unavailable'?'Отчёт пока недоступен: нет подтверждённой связи. Сумма неизвестна, это не 0 ₽.':`Данные получены · чеков: ${saved.report.receiptCount}.`}</p>
    </>}
    {form&&<form onSubmit={event=>{event.preventDefault();void save()}}>
      <fieldset className="onboarding-fields" disabled={!canWrite||busy||Boolean(command.current)} onChange={()=>{dirty.current=true;sequence.current++}}>
        <label className="field"><span>Продолжить со шага</span><select aria-label="Продолжить со шага" value={form.currentStep} onChange={event=>setForm({...form,currentStep:event.target.value as Step})}>{Object.entries(stepNames).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
        <label className="field"><span>ID терминала</span><input aria-label="ID терминала" aria-describedby={'terminal-note-'+draftId} maxLength={80} autoComplete="off" value={form.terminal.id} onChange={event=>setForm({...form,terminal:{...form.terminal,id:event.target.value}})}/><small id={'terminal-note-'+draftId}>ID устройства из кабинета кассы. Ключ сюда не вводится.</small></label>
        <label className="field"><span>Название терминала</span><input maxLength={80} value={form.terminal.label} onChange={event=>setForm({...form,terminal:{...form.terminal,label:event.target.value}})}/></label>
        <label className="field"><span>Кассовые отчёты</span><select aria-label="Кассовые отчёты" value={form.cashReports?'on':'off'} onChange={event=>setForm({...form,cashReports:event.target.value==='on'})}><option value="off">Выключены</option><option value="on">Подключить после проверки связи</option></select></label>
      </fieldset>
      <div className="onboarding-actions">{canWrite&&<button className="btn" disabled={busy}>{busy?'Сохраняем…':command.current?'Повторить сохранение прогресса':'Сохранить прогресс'}</button>}<button className="btn secondary" type="button" disabled={busy} onClick={()=>void load()}>Открыть сохранённый прогресс</button></div>
    </form>}
    {error&&<p className="onboarding-feedback error" role="alert">{error}</p>}{notice&&<p className="onboarding-feedback" role="status">{notice}</p>}
  </section>
}
