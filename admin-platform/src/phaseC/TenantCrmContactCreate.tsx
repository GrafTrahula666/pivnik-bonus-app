import {useEffect,useRef,useState,type FormEvent} from 'react'
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
const emailPattern=/^[a-z0-9.!#$%&'*+/=?^`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/
const validId=/^[1-9][0-9]{0,18}$/
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const hasControlChars=(value:string)=>[...value].some(char=>{
  const code=char.charCodeAt(0)
  return code<=31||code===127
})
const digestPattern=/^[a-f0-9]{64}$/
// Schema v1 must not silently accept account, wallet or bonus fields alongside
// the explicit "unlinked/not_created" status of an owner-entered contact.
const resultKeys='contact,identityStatus,requestKey,schemaVersion,walletStatus'
const contactKeys='email,firstName,id,identityStatus,lastName,phone,walletStatus'
const storagePrefix='spaceverse:crm-manual-contact:pending:v1:'
type Checkpoint={version:1;requestKey:string;nonce:string;digest:string}
type Recovery={checkpoint:Checkpoint|null;blocked:boolean}
const storageError='Нельзя безопасно восстановить незавершённый запрос. Проверьте доступ к хранилищу браузера, не отправляйте новый контакт до сверки.'
const lockError='Браузер не поддерживает безопасную межвкладочную блокировку. Создание контакта остановлено; используйте современный браузер.'
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

function verifyResult(raw:unknown,key:string,expected:Command['contact']):Result{
  const value=raw as Partial<Result>|null
  const contact=value?.contact
  if(!value||typeof value!=='object'||Array.isArray(value)||
    Object.keys(value).sort().join(',')!==resultKeys||
    value.schemaVersion!==1||value.requestKey!==key||!contact||
    typeof contact!=='object'||Array.isArray(contact)||
    Object.keys(contact).sort().join(',')!==contactKeys||
    typeof contact.id!=='string'||!validId.test(contact.id)||
    typeof contact.firstName!=='string'||!contact.firstName.trim()||
    !['unlinked'].includes(String(value.identityStatus))||
    value.walletStatus!=='not_created'||contact.identityStatus!=='unlinked'||contact.walletStatus!=='not_created'||
    !(contact.lastName===null||typeof contact.lastName==='string')||
    !(contact.phone===null||typeof contact.phone==='string')||
    !(contact.email===null||typeof contact.email==='string')||
    // A matching request key alone cannot prove that the returned contact is ours.
    contact.firstName!==expected.firstName||contact.lastName!==expected.lastName||
    contact.phone!==expected.phone||contact.email!==expected.email)
    throw new Error('Некорректное подтверждение контакта')
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
  const lockName='spaceverse:crm-manual-contact:lock:v1:'+actorId+':'+draftId
  const [initial]=useState(()=>readCheckpoint(storageKey))
  const checkpoint=useRef<Checkpoint|null>(initial.checkpoint)
  const blockedByStorage=useRef(initial.blocked)
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
  // Other tabs can change a pending key without this form being remounted.
  // Block immediately on a foreign storage event; never silently adopt or
  // overwrite another tab's contact request.
  useEffect(()=>{
    const onStorage=(event:StorageEvent)=>{
      if(event.storageArea!==localStorage||(event.key!==storageKey&&event.key!==null))return
      const expected=checkpoint.current?JSON.stringify(checkpoint.current):null
      if(event.key===null||event.newValue!==expected){
        blockedByStorage.current=true
        setBlocked(true)
        setError(storageError)
      }
    }
    window.addEventListener('storage',onStorage)
    return ()=>window.removeEventListener('storage',onStorage)
  },[storageKey])
  const locked=busy||(uncertain&&!reenter)||blocked
  function buildCommand():Command|null {
    const first=firstName.trim().replace(/\s+/g,' ')
    const last=lastName.trim().replace(/\s+/g,' ')||null
    const number=phone.replace(/[\s().-]/g,'')||null
    const address=email.trim().toLowerCase()||null
    if(!first||first.length>120||hasControlChars(first)||
      last&&(last.length>120||hasControlChars(last))||
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
      // An already-pending request in this tab or another tab must not be
      // overwritten with a fresh UUID, even if this form mounted earlier.
      if(localStorage.getItem(storageKey)!==null)throw new Error('Pending request exists')
      localStorage.setItem(storageKey,serialized)
      if(localStorage.getItem(storageKey)!==serialized)throw new Error('Storage write failed')
      checkpoint.current=record
      return true
    }catch{setBlocked(true);setError(storageError);return false}
  }
  function matchesStoredCheckpoint():boolean {
    try {
      return checkpoint.current!==null &&
        localStorage.getItem(storageKey)===JSON.stringify(checkpoint.current)
    }catch{return false}
  }
  function clearCheckpoint():boolean {
    try {
      // Never erase another tab's newer pending request after an async POST.
      if(!matchesStoredCheckpoint())throw new Error('Pending request changed')
      localStorage.removeItem(storageKey)
      if(localStorage.getItem(storageKey)!==null)throw new Error('Storage removal failed')
      checkpoint.current=null
      return true
    }catch{setBlocked(true);setError(storageError);return false}
  }
  // The Web Locks API serializes the entire checkpoint/POST lifecycle across
  // tabs; localStorage check-then-set by itself is not atomic.
  async function performLockedRequest(){
    if(blockedByStorage.current)return
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
          command=input
        }
        pending.current=command
      }
      if(!command)throw new Error('Prepared request unavailable')
      // A stale tab must not replay after another tab replaced/cleared its key.
      if(!matchesStoredCheckpoint()){
        setBlocked(true);setError(storageError)
        return
      }
      const result=verifyResult(await apiPost<unknown>(path,command),command.requestKey,command.contact)
      if(blockedByStorage.current){setError(storageError);return}
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
    }
  }
  async function send(event?:FormEvent){
    event?.preventDefault()
    if(inFlight.current||blocked||blockedByStorage.current)return
    inFlight.current=true
    setBusy(true);setError('');setSaved(null)
    try {
      if(typeof navigator.locks?.request!=='function')throw new Error('Web Locks unavailable')
      await navigator.locks.request(lockName,{mode:'exclusive'},performLockedRequest)
    }catch{
      blockedByStorage.current=true
      setBlocked(true);setError(lockError)
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

      {saved&&<p role="status" className="tenant-crm-contact-success">Контакт №{saved.contact.id} создан. Аккаунт не привязан, кошелёк не создан.</p>}
      <div className="tenant-crm-contact-actions">
        {uncertain?<button type="button" className="btn secondary" disabled={busy||blocked||(!pending.current&&!reenter)}
          onClick={()=>void send()}>{busy?'Проверяем результат…':reenter?'Восстановить исходный запрос':'Повторить с тем же ключом'}</button>:
          <button type="submit" className="btn" disabled={busy||blocked}>{busy?'Сохраняем контакт…':'Создать контакт'}</button>}
      </div>
    </form>
  </section>
}
