import { useCallback, useEffect, useRef, useState } from 'react'
import { Building2, Plus, RefreshCw, Save, ShieldCheck, Smartphone } from 'lucide-react'
import { ApiError, apiGet, apiPost, apiPut, type AdminSession } from '../api'
import './venue-onboarding.css'

export interface OnboardingData {
  companyId: string | null
  companyName: string
  venueName: string
  address: string
  timeZone: string
  venueType: 'bar' | 'cafe' | 'restaurant' | 'shop' | 'other'
  ownerEmail: string
}
interface Draft {
  id: string
  requestKey: string
  data: OnboardingData
  status: 'draft'
  revision: number
  updatedAt: string
}
interface Index {drafts: Draft[]; companies: {id:string;name:string}[]}
type Command = {id:string;revision:number;data:OnboardingData} | {requestKey:string;data:OnboardingData}
interface ApplicationConfig {
  displayName:string
  theme:'premium-dark'|'dark'|'light'
  primaryColor:string
  secondaryColor:string
  shopEnabled:boolean
  loyaltyEnabled:boolean
}
interface ApplicationContract {
  template:'standard'
  qrEnabled:true
  isolationPolicy:'dedicated_database'
  legacyDataAccess:false
  runtimeStatus:'not_provisioned'
  published:false
}
interface Application {
  draftId:string
  tenantKey:string
  config:ApplicationConfig
  revision:number
  updatedAt:string
  contract:ApplicationContract
}
type ApplicationCommand={revision:number;config:ApplicationConfig}
const base = '/api/admin/onboarding/drafts'
const empty = ():OnboardingData=>({companyId:null,companyName:'',venueName:'',address:'',timeZone:'Europe/Moscow',venueType:'bar',ownerEmail:''})
const defaultContract:ApplicationContract={template:'standard',qrEnabled:true,isolationPolicy:'dedicated_database',legacyDataAccess:false,runtimeStatus:'not_provisioned',published:false}
const emptyApplication=(displayName=''):ApplicationConfig=>({displayName,theme:'premium-dark',primaryColor:'#73bcd9',secondaryColor:'#172c36',shopEnabled:true,loyaltyEnabled:true})
const message = (error:unknown)=>error instanceof Error?error.message:'Не удалось загрузить черновики.'

// A damaged successful response is uncertain, never a reason to create a new request key.
function draftResponse(raw: unknown): Draft {
  const draft=raw as Partial<Draft>|null
  if(!draft||typeof draft.id!=='string'||typeof draft.requestKey!=='string'||draft.status!=='draft'||
    !Number.isInteger(draft.revision)||Number(draft.revision)<1||!draft.data||
    typeof draft.updatedAt!=='string'||!['companyName','venueName','address','timeZone','venueType','ownerEmail'].every(key=>typeof (draft.data as unknown as Record<string,unknown>)[key]==='string')) {
    throw new Error('Результат сохранения не подтверждён. Повторите сохранение или откройте список черновиков.')
  }
  return draft as Draft
}
function contractResponse(raw:unknown):ApplicationContract {
  const value=raw as Partial<ApplicationContract>|null
  if(!value||value.template!=='standard'||value.qrEnabled!==true||value.isolationPolicy!=='dedicated_database'||
    value.legacyDataAccess!==false||value.runtimeStatus!=='not_provisioned'||value.published!==false) {
    throw new Error('Статус приложения не подтверждён. Откройте сохранённую конфигурацию.')
  }
  return value as ApplicationContract
}
function applicationResponse(raw:unknown):Application {
  const value=raw as Partial<Application>|null,config=value?.config as Partial<ApplicationConfig>|undefined
  if(!value||typeof value.draftId!=='string'||typeof value.tenantKey!=='string'||!/^sv-[0-9a-f]{32}$/.test(value.tenantKey)||
    !Number.isInteger(value.revision)||Number(value.revision)<1||typeof value.updatedAt!=='string'||!config||
    typeof config.displayName!=='string'||!['premium-dark','dark','light'].includes(String(config.theme))||
    !/^#[0-9a-f]{6}$/.test(String(config.primaryColor))||!/^#[0-9a-f]{6}$/.test(String(config.secondaryColor))||
    typeof config.shopEnabled!=='boolean'||typeof config.loyaltyEnabled!=='boolean') {
    throw new Error('Результат настройки приложения не подтверждён. Откройте сохранённую конфигурацию.')
  }
  return {...value,contract:contractResponse(value.contract)} as Application
}

export function VenueOnboarding({session}:{session:AdminSession}) {
  const allowed=session.admin.role==='SUPER_ADMIN'&&session.capabilities.onboardingDrafts===true
  const [index,setIndex]=useState<Index>({drafts:[],companies:[]})
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false)
  const [editing,setEditing]=useState(false),[current,setCurrent]=useState<Draft|null>(null)
  const [data,setData]=useState<OnboardingData>(empty)
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[uncertain,setUncertain]=useState(false)
  const [application,setApplication]=useState<Application|null>(null),[appData,setAppData]=useState<ApplicationConfig>(emptyApplication)
  const [appContract,setAppContract]=useState<ApplicationContract>(defaultContract)
  const [appLoading,setAppLoading]=useState(false),[appBusy,setAppBusy]=useState(false),[appUncertain,setAppUncertain]=useState(false)
  const [appError,setAppError]=useState(''),[appNotice,setAppNotice]=useState('')
  const command=useRef<Command|null>(null),appCommand=useRef<ApplicationCommand|null>(null),createKey=useRef('')
  const busyRef=useRef(false),appBusyRef=useRef(false),sequence=useRef(0),appSequence=useRef(0)
  const checkpoint=`spaceverse:onboarding:create:${session.admin.id}`
  function clearCheckpoint() {
    // An already confirmed server save stays successful even if tab storage becomes unavailable.
    try {sessionStorage.removeItem(checkpoint)} catch { /* recovery UUID is harmless */ }
  }

  const loadApplication=useCallback(async(draft:Draft)=>{
    const run=++appSequence.current
    setAppLoading(true);setAppError('')
    try {
      const result=await apiGet<{application:unknown;contract:unknown}>(base+'/'+draft.id+'/application')
      const contract=contractResponse(result.contract)
      const saved=result.application?applicationResponse(result.application):null
      if(run!==appSequence.current)return
      if(saved&&saved.draftId!==draft.id)throw new Error('Конфигурация относится к другому черновику.')
      setAppContract(contract);setApplication(saved);setAppData(saved?.config||emptyApplication(draft.data.venueName))
      setAppUncertain(false);appCommand.current=null
    } catch(error) {if(run===appSequence.current)setAppError(message(error))}
    finally {if(run===appSequence.current)setAppLoading(false)}
  },[])
  const showDraft=useCallback((draft:Draft)=>{
    setCurrent(draft);setData(draft.data);setEditing(true);command.current=null
    setUncertain(false);setError('');setNotice('Черновик сохранён. Заведение ещё не подключено.')
    setApplication(null);setAppData(emptyApplication(draft.data.venueName));setAppContract(defaultContract)
    setAppError('');setAppNotice('');setAppUncertain(false);appCommand.current=null
    void loadApplication(draft)
  },[loadApplication])
  const load=useCallback(async(recover=false)=>{
    const run=++sequence.current
    setLoading(true);setError('')
    try {
      const result=await apiGet<Index>(base)
      if(!Array.isArray(result.drafts)||!Array.isArray(result.companies)) throw new Error('Не удалось прочитать список черновиков.')
      const checked={...result,drafts:result.drafts.map(draftResponse)}
      if(run!==sequence.current) return
      setIndex(checked)
      if(recover) {
        // Only a non-secret request UUID is kept in this tab; names/contacts/keys stay on the server.
        const key=sessionStorage.getItem(checkpoint)
        let saved=checked.drafts.find(draft=>draft.requestKey===key)
        if(key&&!saved) {
          const result=await apiGet<{draft:unknown}>(base+'?requestKey='+encodeURIComponent(key))
          if(run!==sequence.current) return
          if(result.draft) saved=draftResponse(result.draft)
        }
        if(saved) {showDraft(saved);try {sessionStorage.removeItem(checkpoint)} catch { /* server result is authoritative */ }}
        else if(key) setNotice('Предыдущее сохранение ещё не подтверждено. Обновите список перед созданием нового черновика.')
      }
    } catch(error) {if(run===sequence.current)setError(message(error))}
    finally {if(run===sequence.current)setLoading(false)}
  },[checkpoint,showDraft])

  const invalidateAppLoads=useCallback(()=>{appSequence.current++},[])
  const invalidateLoads=useCallback(()=>{sequence.current++;invalidateAppLoads()},[invalidateAppLoads])

  useEffect(()=>{
    if(allowed) void load(true)
    return invalidateLoads
  },[allowed,invalidateLoads,load])

  function begin() {
    if(busyRef.current) return
    try {createKey.current=sessionStorage.getItem(checkpoint)||crypto.randomUUID()}
    catch {setError('Не удалось подготовить безопасное сохранение. Разрешите хранилище вкладки и повторите.');return}
    invalidateAppLoads();setData(empty());setCurrent(null);setEditing(true);setError('');setNotice('');setUncertain(false);command.current=null
    setApplication(null);setAppData(emptyApplication());setAppContract(defaultContract);setAppError('');setAppNotice('');setAppUncertain(false);appCommand.current=null
  }
  async function open(id:string) {
    if(busyRef.current||appBusyRef.current) return
    busyRef.current=true;setBusy(true);setError('')
    try {showDraft(draftResponse(await apiGet(base+'/'+id)))}
    catch(error) {setError(message(error))}
    finally {busyRef.current=false;setBusy(false)}
  }
  async function save() {
    if(busyRef.current||appBusyRef.current) return
    const body=command.current||(current?{id:current.id,revision:current.revision,data}:{requestKey:createKey.current,data})
    command.current=body
    busyRef.current=true;setBusy(true);setError('');setNotice('')
    try {
      if('requestKey' in body) {
        try {sessionStorage.setItem(checkpoint,body.requestKey)}
        catch {throw new ApiError(400,'ONBOARDING_TAB_STORAGE','Не удалось подготовить сохранение. Разрешите хранилище вкладки и повторите.')}
      }
      const raw='id' in body?await apiPut(base+'/'+body.id,{revision:body.revision,data:body.data}):await apiPost(base,body)
      const saved=draftResponse(raw)
      showDraft(saved)
      setIndex(previous=>({...previous,drafts:[saved,...previous.drafts.filter(draft=>draft.id!==saved.id)].slice(0,50)}))
      clearCheckpoint()
    } catch(error) {
      setError(message(error))
      if(error instanceof ApiError&&error.status>=400&&error.status<500&&error.status!==408) {
        command.current=null;setUncertain(false)
      } else setUncertain(true)
    } finally {busyRef.current=false;setBusy(false)}
  }
  async function saveApplication() {
    if(!current||appBusyRef.current||busyRef.current)return
    const body=appCommand.current||{revision:application?.revision||0,config:appData}
    appCommand.current=body;appBusyRef.current=true;setAppBusy(true);setAppError('');setAppNotice('')
    try {
      const saved=applicationResponse(await apiPut(base+'/'+current.id+'/application',body))
      if(saved.draftId!==current.id)throw new Error('Сервер вернул конфигурацию другого черновика.')
      setApplication(saved);setAppData(saved.config);setAppContract(saved.contract);setAppUncertain(false);appCommand.current=null
      setAppNotice('Настройка приложения сохранена. Приложение ещё не опубликовано.')
    } catch(error) {
      setAppError(message(error))
      if(error instanceof ApiError&&error.status>=400&&error.status<500&&error.status!==408){appCommand.current=null;setAppUncertain(false)}
      else setAppUncertain(true)
    } finally {appBusyRef.current=false;setAppBusy(false)}
  }
  function change<K extends keyof OnboardingData>(key:K,value:OnboardingData[K]) {
    setData(previous=>({...previous,[key]:value}));setNotice('')
  }
  function changeApplication<K extends keyof ApplicationConfig>(key:K,value:ApplicationConfig[K]) {
    setAppData(previous=>({...previous,[key]:value}));setAppNotice('')
  }
  if(!allowed) return null

  return <section className="card onboarding" aria-label="Подключение заведений">
    <div className="onboarding-head">
      <div><span className="eyebrow">ПОДКЛЮЧЕНИЕ ЗАВЕДЕНИЙ</span><h2>Новое заведение</h2><p>Сохраните данные сейчас и продолжите настройку позже.</p></div>
      <button className="btn" disabled={busy||loading||editing} onClick={begin}><Plus size={16}/>Добавить заведение</button>
    </div>
    {error&&<div className="onboarding-feedback error" role="alert">{error}</div>}
    {notice&&<p className="onboarding-feedback" role="status">{notice}</p>}
    {editing&&<form onSubmit={event=>{event.preventDefault();void save()}}>
      <div className="onboarding-step"><Building2 size={18}/><b>Данные заведения</b><span>Черновик · ещё не подключено</span></div>
      <fieldset className="onboarding-fields" disabled={busy||uncertain||appBusy}>
        <label className="field"><span>Название заведения</span><input required maxLength={120} value={data.venueName} onChange={event=>{
          const venueName=event.target.value
          setData(previous=>({...previous,venueName,companyName:!previous.companyId&&(!previous.companyName||previous.companyName===previous.venueName)?venueName:previous.companyName}));setNotice('')
        }}/></label>
        <label className="field"><span>Организация</span><select value={data.companyId||'new'} onChange={event=>{
          const companyId=event.target.value==='new'?null:event.target.value
          setData(previous=>({...previous,companyId,companyName:companyId?'':previous.venueName}));setNotice('')
        }}><option value="new">Новая организация</option>{index.companies.map(company=><option key={company.id} value={company.id}>{company.name}</option>)}
          {data.companyId&&!index.companies.some(company=>company.id===data.companyId)&&<option value={data.companyId} disabled>Организация недоступна</option>}
        </select></label>
        {!data.companyId&&<label className="field"><span>Название организации</span><input required maxLength={120} value={data.companyName} onChange={event=>change('companyName',event.target.value)}/></label>}
        <label className="field"><span>Тип заведения</span><select value={data.venueType} onChange={event=>change('venueType',event.target.value as OnboardingData['venueType'])}>
          <option value="bar">Бар</option><option value="cafe">Кафе</option><option value="restaurant">Ресторан</option><option value="shop">Магазин</option><option value="other">Другое</option>
        </select></label>
        <label className="field"><span>Адрес</span><input maxLength={300} value={data.address} onChange={event=>change('address',event.target.value)}/></label>
        <label className="field"><span>Часовой пояс</span><input required list="onboarding-timezones" maxLength={64} value={data.timeZone} onChange={event=>change('timeZone',event.target.value)}/>
          <datalist id="onboarding-timezones"><option value="Europe/Moscow"/><option value="Europe/Kaliningrad"/><option value="Asia/Yekaterinburg"/><option value="Asia/Novosibirsk"/><option value="Asia/Vladivostok"/></datalist>
        </label>
        <label className="field"><span>Email владельца</span><input aria-label="Email владельца" aria-describedby="onboarding-owner-note" type="email" maxLength={254} value={data.ownerEmail} onChange={event=>change('ownerEmail',event.target.value)}/><small id="onboarding-owner-note">Приглашение на этом шаге не отправляется.</small></label>
      </fieldset>
      <div className="onboarding-actions">
        <button className="btn" type="submit" disabled={busy||appBusy}><Save size={16}/>{busy?'Сохраняем…':uncertain?'Повторить сохранение':'Сохранить черновик'}</button>
        <button className="btn secondary" type="button" disabled={busy||appBusy} onClick={()=>current?void open(current.id):void load(true)}><RefreshCw size={16}/>Открыть сохранённую версию</button>
        <button className="btn secondary" type="button" disabled={busy||uncertain||appBusy||appUncertain} onClick={()=>{invalidateAppLoads();setEditing(false);setNotice('');setError('');setAppError('');setAppNotice('')}}>Закрыть</button>
      </div>
    </form>}
    {editing&&current&&<form className="onboarding-application" onSubmit={event=>{event.preventDefault();void saveApplication()}}>
      <div className="onboarding-step"><Smartphone size={18}/><b>Приложение</b><span>{application?'Конфигурация сохранена':'Не настроено'} · приложение ещё не опубликовано</span></div>
      {appError&&<div className="onboarding-feedback error" role="alert">{appError}</div>}
      {appNotice&&<p className="onboarding-feedback" role="status">{appNotice}</p>}
      <div className="onboarding-contract" aria-label="Статус приложения">
        <div><ShieldCheck size={17}/><span><b>Изоляция данных</b><small>{appContract.isolationPolicy==='dedicated_database'?'Отдельная база обязательна':'Не подтверждена'} · {appContract.legacyDataAccess?'есть доступ к legacy':'без доступа к ПИВНИКУ'}</small></span></div>
        <div><span><b>Шаблон</b><small>{appContract.template==='standard'?'Стандартный':'Не подтверждён'} · {appContract.qrEnabled?'QR включён':'QR не настроен'}</small></span></div>
        <div><span><b>Публикация</b><small>{appContract.published?'Опубликовано':appContract.runtimeStatus==='not_provisioned'?'Не запускалась':'Не подтверждена'}</small></span></div>
        {application&&<div><span><b>Tenant ID</b><small className="tenant-key">{application.tenantKey}</small></span></div>}
      </div>
      <fieldset className="onboarding-fields" disabled={appBusy||appLoading||appUncertain||busy}>
        <label className="field"><span>Название приложения</span><input required maxLength={120} value={appData.displayName} onChange={event=>changeApplication('displayName',event.target.value)}/></label>
        <label className="field"><span>Тема</span><select value={appData.theme} onChange={event=>changeApplication('theme',event.target.value as ApplicationConfig['theme'])}>
          <option value="premium-dark">Тёмная премиальная</option><option value="dark">Тёмная</option><option value="light">Светлая</option>
        </select></label>
        <label className="field"><span>Основной цвет</span><div className="onboarding-color"><input aria-label="Основной цвет палитра" type="color" value={appData.primaryColor} onChange={event=>changeApplication('primaryColor',event.target.value)}/><input aria-label="Основной цвет" pattern="#[0-9A-Fa-f]{6}" maxLength={7} value={appData.primaryColor} onChange={event=>changeApplication('primaryColor',event.target.value)}/></div></label>
        <label className="field"><span>Дополнительный цвет</span><div className="onboarding-color"><input aria-label="Дополнительный цвет палитра" type="color" value={appData.secondaryColor} onChange={event=>changeApplication('secondaryColor',event.target.value)}/><input aria-label="Дополнительный цвет" pattern="#[0-9A-Fa-f]{6}" maxLength={7} value={appData.secondaryColor} onChange={event=>changeApplication('secondaryColor',event.target.value)}/></div></label>
        <label className="onboarding-check"><input type="checkbox" checked={appData.shopEnabled} onChange={event=>changeApplication('shopEnabled',event.target.checked)}/><span><b>Магазин</b><small>Подготовить раздел стандартного шаблона</small></span></label>
        <label className="onboarding-check"><input type="checkbox" checked={appData.loyaltyEnabled} onChange={event=>changeApplication('loyaltyEnabled',event.target.checked)}/><span><b>Лояльность</b><small>Только поддерживаемая базовая конфигурация</small></span></label>
      </fieldset>
      <p className="onboarding-note">Логотип и ключи Telegram, VK и кассы здесь пока не принимаются: для них нужен защищённый канал хранения. Эта настройка не даёт доступ к кошелькам ПИВНИКА.</p>
      <div className="onboarding-actions">
        <button className="btn" type="submit" disabled={appBusy||appLoading||busy}><Save size={16}/>{appBusy?'Сохраняем…':appUncertain?'Повторить сохранение приложения':'Сохранить приложение'}</button>
        <button className="btn secondary" type="button" disabled={appBusy||appLoading} onClick={()=>void loadApplication(current)}><RefreshCw size={16}/>Открыть сохранённую конфигурацию</button>
      </div>
    </form>}
    <div className="onboarding-list-head"><b>Черновики подключения</b><button className="btn secondary" disabled={busy||appBusy||loading} onClick={()=>void load()}><RefreshCw size={14}/>Обновить</button></div>
    {loading?<p role="status">Загружаем черновики…</p>:<>
      {!index.drafts.length&&<p>Сохранённых черновиков пока нет.</p>}
      <ul className="onboarding-list">{index.drafts.map(draft=><li key={draft.id}>
        <div><b>{draft.data.venueName}</b><small>{draft.data.companyName||index.companies.find(company=>company.id===draft.data.companyId)?.name||'Организация недоступна'} · Черновик</small></div>
        <button className="btn secondary" disabled={busy||appBusy||uncertain||appUncertain} onClick={()=>void open(draft.id)} aria-label={'Открыть черновик '+draft.data.venueName}>Открыть</button>
      </li>)}</ul>
      {index.drafts.length===50&&<small>Показаны последние 50 черновиков.</small>}
    </>}
  </section>
}
