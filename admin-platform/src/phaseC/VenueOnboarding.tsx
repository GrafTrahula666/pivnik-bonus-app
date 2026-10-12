import { useCallback, useEffect, useRef, useState } from 'react'
import { Building2, Plus, RefreshCw, Save } from 'lucide-react'
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
const base = '/api/admin/onboarding/drafts'
const empty = ():OnboardingData=>({companyId:null,companyName:'',venueName:'',address:'',timeZone:'Europe/Moscow',venueType:'bar',ownerEmail:''})
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

export function VenueOnboarding({session}:{session:AdminSession}) {
  const allowed=session.admin.role==='SUPER_ADMIN'&&session.capabilities.onboardingDrafts===true
  const [index,setIndex]=useState<Index>({drafts:[],companies:[]})
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false)
  const [editing,setEditing]=useState(false),[current,setCurrent]=useState<Draft|null>(null)
  const [data,setData]=useState<OnboardingData>(empty)
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[uncertain,setUncertain]=useState(false)
  const command=useRef<Command|null>(null),createKey=useRef(''),busyRef=useRef(false),sequence=useRef(0)
  const checkpoint=`spaceverse:onboarding:create:${session.admin.id}`
  function clearCheckpoint() {
    // An already confirmed server save stays successful even if tab storage becomes unavailable.
    try {sessionStorage.removeItem(checkpoint)} catch { /* recovery UUID is harmless */ }
  }

  function showDraft(draft:Draft) {
    setCurrent(draft);setData(draft.data);setEditing(true);command.current=null
    setUncertain(false);setError('');setNotice('Черновик сохранён. Заведение ещё не подключено.')
  }
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
  },[checkpoint])

  useEffect(()=>{
    if(allowed) void load(true)
    return()=>{sequence.current++}
  },[allowed,load])

  function begin() {
    if(busyRef.current) return
    try {createKey.current=sessionStorage.getItem(checkpoint)||crypto.randomUUID()}
    catch {setError('Не удалось подготовить безопасное сохранение. Разрешите хранилище вкладки и повторите.');return}
    setData(empty());setCurrent(null);setEditing(true);setError('');setNotice('');setUncertain(false);command.current=null
  }
  async function open(id:string) {
    if(busyRef.current) return
    busyRef.current=true;setBusy(true);setError('')
    try {showDraft(draftResponse(await apiGet(base+'/'+id)))}
    catch(error) {setError(message(error))}
    finally {busyRef.current=false;setBusy(false)}
  }
  async function save() {
    if(busyRef.current) return
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
  function change<K extends keyof OnboardingData>(key:K,value:OnboardingData[K]) {
    setData(previous=>({...previous,[key]:value}));setNotice('')
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
      <fieldset className="onboarding-fields" disabled={busy||uncertain}>
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
        <button className="btn" type="submit" disabled={busy}><Save size={16}/>{busy?'Сохраняем…':uncertain?'Повторить сохранение':'Сохранить черновик'}</button>
        <button className="btn secondary" type="button" disabled={busy} onClick={()=>current?void open(current.id):void load(true)}><RefreshCw size={16}/>Открыть сохранённую версию</button>
        <button className="btn secondary" type="button" disabled={busy||uncertain} onClick={()=>{setEditing(false);setNotice('');setError('')}}>Закрыть</button>
      </div>
    </form>}
    <div className="onboarding-list-head"><b>Черновики подключения</b><button className="btn secondary" disabled={busy||loading} onClick={()=>void load()}><RefreshCw size={14}/>Обновить</button></div>
    {loading?<p role="status">Загружаем черновики…</p>:<>
      {!index.drafts.length&&<p>Сохранённых черновиков пока нет.</p>}
      <ul className="onboarding-list">{index.drafts.map(draft=><li key={draft.id}>
        <div><b>{draft.data.venueName}</b><small>{draft.data.companyName||index.companies.find(company=>company.id===draft.data.companyId)?.name||'Организация недоступна'} · Черновик</small></div>
        <button className="btn secondary" disabled={busy||uncertain} onClick={()=>void open(draft.id)} aria-label={'Открыть черновик '+draft.data.venueName}>Открыть</button>
      </li>)}</ul>
      {index.drafts.length===50&&<small>Показаны последние 50 черновиков.</small>}
    </>}
  </section>
}
