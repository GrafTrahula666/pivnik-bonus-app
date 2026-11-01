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
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const digestPattern=/^[a-f0-9]{64}$/
const storagePrefix='spaceverse:crm-manual-contact:pending:v1:'
type Checkpoint={version:1;requestKey:string;nonce:string;digest:string}
type Recovery={checkpoint:Checkpoint|null;blocked:boolean}
const storageError='Нельзя безопасно восстановить незавершённый запрос. Проверьте доступ к хранилищу браузера, не отправляйте новый контакт до сверки.'
const recoveryNotice='Есть незавершённый запрос. Повторно введите исходные данные контакта: их значения не сохранялись в браузере. После совпадения отправим прежний запрос.'
const mismatchNotice='Данные отличаются от незавершённого запроса. Введите те же имя, фамилию, телефон и email, что были перед обновлением страницы.'
function readCheckpoint(key:string):Recovery {
  try {
    const raw=localStorage.getItem(key)
    if(raw===null)return {checkpoint:null,blocked:false}
    const value:unknown=JSON.parse(raw)
    if(!value||typeof value!=='object'||Array.isArray(value))return {checkpoint:null,blocked:true}
    const record=value as Record<string,unknown>
    if(Object.keys(record).sort().join(',')!=='digest,nonce,requestKey,version'||
      record.version!==1||typeof record.requestKey!=='string'||!uuid.test(record.requestKey)||
      typeof record.nonce!=='string'||!uuid.test(record.nonce)||
      typeof record.digest!=='string'||!digestPattern.test(record.digest))
      return {checkpoint:null,blocked:true}
    return {checkpoint:record as Checkpoint,blocked:false}
  } catch {return {checkpoint:null,blocked:true}}
}
async function contactDigest(contact:Command['contact'],nonce:string):Promise<string>{
  const subtle=globalThis.crypto?.subtle
  if(!subtle)throw new Error('Browser cryptography unavailable')
  const bytes=new TextEncoder().encode(nonce+':'+JSON.stringify(contact))
  const hash=await subtle.digest('SHA-256',bytes)
  return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')
}

function verifyResult(raw:unknown,key:string):Result{
  const value=raw as Partial<Result>|null
  const contact=value?.contact
  if(!value||value.schemaVersion!==1||value.requestKey!==key||!contact||
    typeof contact.id!=='string'||!validId.test(contact.id)||
    typeof contact.firstName!=='string'||!contact.firstName.trim()||
    !['unlinked'].includes(String(value.identityStatus))||
    value.walletStatus!=='not_created'||contact.identityStatus!=='unlinked'||contact.walletStatus!=='not_created'||
    !(contact.lastName===null||typeof contact.lastName==='string')||
    !(contact.phone===null||typeof contact.phone==='string')||
    !(contact.email===null||typeof contact.email==='string'))throw new Error('Некорректное подтверждение контакта')
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
  return <ContactForm key={actorId+':'+draftId} actorId={actorId} draftId={draftId}/>
}
function ContactForm({actorId,draftId}:Props){
  const storageKey=storagePrefix+actorId+':'+draftId
  const [initial]=useState(()=>readCheckpoint(storageKey))
  const checkpoint=useRef<Checkpoint|null>(initial.checkpoint)
  const [blocked,setBlocked]=useState(initial.blocked)
  const [reenter,setReenter]=useState(initial.checkpoint!==null)
  const [firstName,setFirstName]=useState(''),[lastName,setLastName]=useState('')
  const [phone,setPhone]=useState(''),[email,setEmail]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState(initial.blocked?storageError:initial.checkpoint?recoveryNotice:'')
  const [uncertain,setUncertain]=useState(initial.checkpoint!==null)
  const [saved,setSaved]=useState<Result|null>(null)
  const pending=useRef<Command|null>(null),inFlight=useRef(false)
  const path='/api/admin/onboarding/drafts/'+encodeURIComponent(draftId)+'/crm/contacts'
  const locked=busy||(uncertain&&!reenter)||blocked
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
  // Persist *only* a UUID and a salted contact fingerprint. No contact PII
  // goes into localStorage. The original values must be entered again after
  // reload, otherwise the pending key remains blocked. Fail closed when
  // browser persistence is disabled or damaged.
  function persist(record:Checkpoint):boolean {
    try {
      const serialized=JSON.stringify(record)
      localStorage.setItem(storageKey,serialized)
      if(localStorage.getItem(storageKey)!==serialized)throw new Error('Storage write failed')
      checkpoint.current=record
      return true
    }catch{setBlocked(true);setError(storageError);return false}
  }
  function clearCheckpoint():boolean {
    try {
      localStorage.removeItem(storageKey)
      if(localStorage.getItem(storageKey)!==null)throw new Error('Storage removal failed')
      checkpoint.current=null
      return true
    }catch{setBlocked(true);setError(storageError);return false}
  }
  async function send(event?:FormEvent){
    event?.preventDefault()
    if(inFlight.current||blocked)return
    inFlight.current=true
    setBusy(true);setError('');setSaved(null)
    let command:Command|null=null
    let retrying=uncertain
    try {
      if(pending.current) {
        command=pending.current
        retrying=true
      } else {
        const input=buildCommand()
        if(!input)return
        if(checkpoint.current) {
          const digest=await contactDigest(input.contact,checkpoint.current.nonce)
          if(digest!==checkpoint.current.digest){
            setError(mismatchNotice)
            return
          }
          command={...input,requestKey:checkpoint.current.requestKey}
          retrying=true
          setReenter(false)
        } else {
          const nonce=crypto.randomUUID()
          const digest=await contactDigest(input.contact,nonce)
          if(!persist({version:1,requestKey:input.requestKey,nonce,digest}))return
        }
        pending.current=command
      }
      const result=verifyResult(await apiPost<unknown>(path,command),command.requestKey)
      if(!clearCheckpoint())return
      pending.current=null;setUncertain(false);setReenter(false);setSaved(result)
      setFirstName('');setLastName('');setPhone('');setEmail('')
    }catch(caught){
      if(!command){
        // This is a local browser crypto/storage failure, before any POST.
        setBlocked(true);setError(storageError)
      }else{
        setError(errorMessage(caught))
        // Only an initial definitive failure can be safely abandoned.
        // On *any* recovery error keep the same key, even after 401/429.
        if(confirmedFailure(caught)&&!retrying){
          if(clearCheckpoint()){pending.current=null;setUncertain(false);setReenter(false)}
        }else setUncertain(true)
      }
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
      {uncertain&&<p role="status">{reenter?recoveryNotice:'Данные заблокированы до проверки результата. Повтор использует прежний ключ запроса.'}</p>}
      {blocked&&<p role="alert">{storageError}</p>}
      {saved&&<p role="status" className="tenant-crm-contact-success">Контакт №{saved.contact.id} создан. Аккаунт не привязан, кошелёк не создан.</p>}
      <div className="tenant-crm-contact-actions">
        {uncertain?<button type="button" className="btn secondary" disabled={busy||blocked||(!pending.current&&!reenter)}
          onClick={()=>void send()}>{busy?'Проверяем результат…':reenter?'Восстановить исходный запрос':'Повторить с тем же ключом'}</button>:
          <button type="submit" className="btn" disabled={busy||blocked}>{busy?'Сохраняем контакт…':'Создать контакт'}</button>}
      </div>
    </form>
  </section>
}
