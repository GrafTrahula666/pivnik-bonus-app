import {useRef,useState,type FormEvent} from 'react'
import {ApiError,apiPost} from '../api'
import './tenant-crm-contact-create.css'

type Command={
  requestKey:string
  contact:{firstName:string;lastName:string|null;phone:string|null;email:string|null}
}
type Result={
  schemaVersion:1
  requestKey:string
  contact:{id:string;firstName:string;lastName:string|null;phone:string|null;email:string|null;
    identityStatus:'unlinked';walletStatus:'not_created'}
  identityStatus:'unlinked'
  walletStatus:'not_created'
}
interface Props {actorId:string;draftId:string}
const phonePattern=/^\+[1-9][0-9]{7,14}$/
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/
const validId=/^[1-9][0-9]{0,18}$/
const validUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function verifyResult(raw:unknown,key:string):Result{
  const value=raw as Partial<Result>|null
  const contact=value?.contact
  if(!value||value.schemaVersion!==1||value.requestKey!==key||!contact||
    typeof contact.id!=='string'||!validId.test(contact.id)||
    typeof contact.firstName!=='string'||!contact.firstName.trim()||
    !['unlinked'].includes(String(value.identityStatus))||
    value.walletStatus!=='not_created'||contact.identityStatus!=='unlinked'||contact.walletStatus!=='not_created'||
    !['string','object'].includes(typeof contact.lastName)||
    !['string','object'].includes(typeof contact.phone)||
    !['string','object'].includes(typeof contact.email))throw new Error('Некорректное подтверждение контакта')
  return value as Result
}
function errorMessage(error:unknown){
  if(error instanceof ApiError){
    if(error.status===401)return 'Сессия истекла. Войдите повторно.'
    if(error.status===403||error.status===404)return 'Нет подтверждённых прав владельца на это заведение или создание отключено.'
    if(error.code==='TENANT_CRM_CONTACT_DUPLICATE')return 'Этот телефон или email уже используется в заведении.'
    if(error.code==='TENANT_CRM_CONTACT_REPLAY_CONFLICT')return 'Ключ запроса уже был использован. Проверьте контакт и начните заново.'
    if(error.code==='TENANT_CRM_CONTACT_SOURCE_NOT_CONFIGURED')return 'Выделенная база заведения ещё не подключена.'
    if(error.code==='TENANT_CRM_CONTACT_SCOPE_REJECTED')return 'Привязка базы заведения не подтверждена.'
    if(error.status===429)return 'Слишком много запросов. Повторите позднее.'
    if(error.status===400)return 'Проверьте введённые данные контакта.'
  }
  return 'Подтверждение не получено. Контакт мог сохраниться: повторите с тем же ключом, не создавайте новый.'
}
const confirmedFailure=(error:unknown)=>error instanceof ApiError&&
  [400,401,403,404,409,429].includes(error.status)

export function TenantCrmContactCreate({actorId,draftId}:Props){
  return <ContactForm key={actorId+':'+draftId} draftId={draftId}/>
}
function ContactForm({draftId}:{draftId:string}){
  const [firstName,setFirstName]=useState(''),[lastName,setLastName]=useState('')
  const [phone,setPhone]=useState(''),[email,setEmail]=useState('')
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const [uncertain,setUncertain]=useState(false),[saved,setSaved]=useState<Result|null>(null)
  const pending=useRef<Command|null>(null),inFlight=useRef(false)
  const path='/api/admin/onboarding/drafts/'+encodeURIComponent(draftId)+'/crm/contacts'
  const locked=busy||uncertain
  function buildCommand():Command|null {
    const first=firstName.trim().replace(/\s+/g,' ')
    const last=lastName.trim().replace(/\s+/g,' ')||null
    const number=phone.replace(/[\s().-]/g,'')||null
    const address=email.trim().toLowerCase()||null
    if(!first||first.length>120||last&&last.length>120||
      number&&!phonePattern.test(number)||address&&(!emailPattern.test(address)||address.length>254)||
      (!number&&!address)){
      setError('Укажите имя и хотя бы один контакт: телефон в формате +79991234567 или корректный email.')
      return null
    }
    return {requestKey:crypto.randomUUID(),contact:{
      firstName:first,lastName:last,phone:number,email:address}}
  }
  async function send(event?:FormEvent){
    event?.preventDefault()
    if(inFlight.current)return
    const command=pending.current??buildCommand()
    if(!command)return
    pending.current=command;inFlight.current=true
    setBusy(true);setError('');setSaved(null)
    try{
      const result=verifyResult(await apiPost<unknown>(path,command),command.requestKey)
      pending.current=null;setUncertain(false);setSaved(result)
      setFirstName('');setLastName('');setPhone('');setEmail('')
    }catch(caught){
      setError(errorMessage(caught))
      if(confirmedFailure(caught)){pending.current=null;setUncertain(false)}
      else setUncertain(true)
    }finally{inFlight.current=false;setBusy(false)}
  }
  return <section className="tenant-crm-contact" aria-label="Создать ручной контакт CRM" aria-busy={busy}>
    <div className="tenant-crm-contact-head">
      <div><h3>Новый контакт CRM</h3><p>Ручной контакт хранится отдельно от аккаунтов приложения. Бонусы и профиль гостя не создаются.</p></div>
    </div>
    <form onSubmit={event=>void send(event)}>
      <fieldset className="tenant-crm-contact-grid" disabled={locked}>
        <label className="field"><span>Имя *</span><input required autoComplete="off" maxLength={120}
          value={firstName} onChange={event=>setFirstName(event.target.value)}/></label>
        <label className="field"><span>Фамилия</span><input autoComplete="off" maxLength={120}
          value={lastName} onChange={event=>setLastName(event.target.value)}/></label>
        <label className="field"><span>Телефон</span><input type="tel" autoComplete="off" inputMode="tel"
          placeholder="+79991234567" maxLength={32} value={phone} onChange={event=>setPhone(event.target.value)}/></label>
        <label className="field"><span>Email</span><input type="email" autoComplete="off" maxLength={254}
          placeholder="example@domain.ru" value={email} onChange={event=>setEmail(event.target.value)}/></label>
      </fieldset>
      <p className="tenant-crm-contact-hint">* Обязательное поле. Нужен хотя бы один способ связи: телефон или email.</p>
      {error&&<p role="alert" className="tenant-crm-contact-error">{error}</p>}
      {uncertain&&<p role="status">Данные заблокированы до проверки результата. Повтор использует прежний ключ запроса.</p>}
      {saved&&<p role="status" className="tenant-crm-contact-success">Контакт №{saved.contact.id} создан. Аккаунт не привязан, кошелёк не создан.</p>}
      <div className="tenant-crm-contact-actions">
        {uncertain?<button type="button" className="btn secondary" disabled={busy||!pending.current}
          onClick={()=>void send()}>{busy?'Проверяем результат…':'Повторить с тем же ключом'}</button>:
          <button type="submit" className="btn" disabled={busy}>{busy?'Сохраняем контакт…':'Создать контакт'}</button>}
      </div>
    </form>
  </section>
}
