import {useEffect,useRef,useState} from 'react'
import {apiGet,ApiError} from '../api'
import {customerName,customerWallet,directoryPage,formatExact,verifiedEnvelope,type CustomerWallet,type DirectoryPage,type Scope} from './tenant-crm-contract'
import './tenant-crm-directory.css'

interface Props {actorId:string;draftId:string;scope:Scope}
interface ActiveProps {actorId:string;scope:Scope}
function message(error:unknown){
  if(error instanceof ApiError){
    if(error.status===401)return 'Сессия истекла. Войдите снова.'
    if(error.code==='TENANT_CRM_SOURCE_NOT_CONFIGURED')return 'Источник клиентских данных ещё не подключён.'
    if(error.code==='TENANT_CRM_PILOT_READ_DISABLED')return 'Пилотный просмотр ещё не разрешён. Клиентская база не активирована.'
    if(error.status===403)return 'Проверка недоступна или у вас нет доступа к клиентам этого заведения.'
    if(error.status===429)return 'Слишком частые проверки. Повторите через минуту.'
  }
  return 'Не удалось подтвердить данные этого заведения. Повторите проверку.'
}
export function TenantCustomerDirectory(props:Props){
  return <Directory key={`${props.actorId}:${props.draftId}:${props.scope.companyId}:${props.scope.venueId}`} {...props}/>
}
export function ActiveTenantCustomerDirectory(props:ActiveProps){
  return <Directory key={`pilot:${props.actorId}:${props.scope.companyId}:${props.scope.venueId}`}
    actorId={props.actorId} draftId="" scope={props.scope} activePilot/>
}
function Directory({draftId,scope,activePilot=false}:Props & {activePilot?:boolean}){
  const {companyId,venueId}=scope
  const [started,setStarted]=useState(activePilot),[query,setQuery]=useState(''),[q,setQ]=useState(''),[offset,setOffset]=useState(0)
  const [sort,setSort]=useState<'id'|'name'|'username'>('id')
  const [direction,setDirection]=useState<'asc'|'desc'>('asc')
  const [wallet,setWallet]=useState<'all'|'present'|'missing'>('all')
  const [page,setPage]=useState<DirectoryPage|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0)
  const [selected,setSelected]=useState<{id:string;revision:number}|null>(null)
  const sequence=useRef(0),selection=useRef(0),limit=25
  const path=activePilot?`/api/admin/venues/${encodeURIComponent(venueId)}/clients`:
    `/api/admin/onboarding/drafts/${encodeURIComponent(draftId)}/crm/customers`
  useEffect(()=>{
    if(!started)return
    let cancelled=false;const current=++sequence.current
    setLoading(true);setPage(null);setError('')
    const request={q,limit,offset,sort,direction,wallet},params=new URLSearchParams({q,limit:String(limit),offset:String(offset),sort,direction,wallet})
    void apiGet<unknown>(path+'?'+params).then(raw=>{
      if(!cancelled&&current===sequence.current)setPage(directoryPage(raw,{companyId,venueId},request))
    }).catch(error=>{if(!cancelled&&current===sequence.current)setError(message(error))})
      .finally(()=>{if(!cancelled&&current===sequence.current)setLoading(false)})
    return()=>{cancelled=true}
  },[path,companyId,venueId,started,q,offset,sort,direction,wallet,revision])
  function change(nextQ:string,nextOffset:number,nextSort=sort,nextDirection=direction,nextWallet=wallet){
    sequence.current++;setPage(null);setSelected(null);setError('');setLoading(true)
    setQ(nextQ);setOffset(nextOffset);setSort(nextSort);setDirection(nextDirection);setWallet(nextWallet);setRevision(value=>value+1);setStarted(true)
  }
  return <section className="tenant-crm" aria-label={activePilot?"Клиентская база заведения":"Проверка клиентской базы"}>
    <h3>Клиентская база</h3>
    <p>{activePilot?'Клиентская база из отдельного источника. Пилотный просмотр не означает коммерческую активацию.':'Проверьте доступ к клиентам этого заведения. Связь с кассой проверяется отдельно.'}</p>
    {!started&&<button type="button" className="btn" onClick={()=>change('',0)}>{activePilot?'Загрузить клиентов':'Проверить клиентскую базу'}</button>}
    {started&&<>
      <form className="tenant-crm-search" onSubmit={event=>{event.preventDefault();change(query.trim(),0)}}>
        <label className="field"><span>Найти клиента</span><input maxLength={100} value={query} onChange={event=>setQuery(event.target.value)} placeholder="Имя или идентификатор"/></label>
        <label className="field"><span>Сортировать по</span><select aria-label="Сортировать по" value={sort} disabled={loading} onChange={event=>change(q,0,event.target.value as 'id'|'name'|'username')}><option value="id">ID клиента</option><option value="name">Имени</option><option value="username">Нику</option></select></label>
        <label className="field"><span>Порядок</span><select aria-label="Порядок" value={direction} disabled={loading} onChange={event=>change(q,0,sort,event.target.value as 'asc'|'desc')}><option value="asc">По возрастанию</option><option value="desc">По убыванию</option></select></label>
        <label className="field"><span>Бонусный кошелёк</span><select aria-label="Бонусный кошелёк" value={wallet} disabled={loading} onChange={event=>change(q,0,sort,direction,event.target.value as 'all'|'present'|'missing')}><option value="all">Все клиенты</option><option value="present">Есть кошелёк</option><option value="missing">Без кошелька</option></select></label>
        <button className="btn" disabled={loading}>Найти</button>
        <button className="btn secondary" type="button" disabled={loading} onClick={()=>change(q,offset)}>Обновить</button>
      </form>
      {loading&&<p role="status">Проверяем клиентскую базу…</p>}
      {error&&<div><p role="alert">{error}</p><button type="button" className="btn secondary" disabled={loading} onClick={()=>change(q,offset)}>Повторить проверку</button></div>}
      {page&&<>
        <p role="status">Доступ к клиентской базе проверен. Найдено клиентов: {formatExact(page.total)}.</p>
        {page.items.length===0?<p>{page.total!=='0'&&offset>0?'На этой странице клиентов нет. Вернитесь на предыдущую страницу.':q?'По запросу клиентов не найдено. Измените поиск или фильтр кошелька.':wallet==='present'?'Клиентов с бонусным кошельком не найдено.':wallet==='missing'?'Клиентов без бонусного кошелька не найдено.':'Клиентов пока нет.'}</p>:
          <ul className="tenant-crm-list">{page.items.map(row=><li key={row.customer.id}>
            <button type="button" className="tenant-crm-row" onClick={()=>setSelected({id:row.customer.id,revision:++selection.current})}>
              <span>{customerName(row)}</span><span>{row.wallet?formatExact(row.wallet.balance)+' бонусов':'Кошелёк не создан'}</span>
            </button>
          </li>)}</ul>}
        <div className="tenant-crm-pagination">
          <button className="btn secondary" type="button" disabled={offset===0||loading} onClick={()=>change(q,Math.max(0,offset-limit))}>Назад</button>
          <span>Страница {Math.floor(offset/limit)+1}</span>
          <button className="btn secondary" type="button" disabled={!page.hasMore||loading||offset+limit>1000000} onClick={()=>change(q,offset+limit)}>Далее</button>
        </div>
      </>}
      {selected&&<CustomerSnapshot key={`${selected.id}:${selected.revision}`} path={path} id={selected.id} scope={scope} onClose={()=>setSelected(null)}/>}
    </>}
  </section>
}
function CustomerSnapshot({path,id,scope,onClose}:{path:string;id:string;scope:Scope;onClose:()=>void}){
  const {companyId,venueId}=scope
  const [row,setRow]=useState<CustomerWallet|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0)
  useEffect(()=>{
    let cancelled=false
    setRow(null);setError('')
    void apiGet<unknown>(path+'/'+encodeURIComponent(id)).then(raw=>{
      const value=verifiedEnvelope(raw,{companyId,venueId}),next=customerWallet(value)
      if(next.customer.id!==id)throw new Error('Customer mismatch')
      if(!cancelled)setRow(next)
    }).catch(error=>{if(!cancelled)setError(message(error))})
    return()=>{cancelled=true}
  },[path,id,companyId,venueId,retry])
  return <section className="tenant-crm-card" aria-label="Карточка клиента">
    <button type="button" className="btn secondary" onClick={onClose}>Закрыть карточку</button>
    {error?<div><p role="alert">{error}</p><button type="button" className="btn secondary" onClick={()=>{setError('');setRow(null);setRetry(value=>value+1)}}>Повторить проверку карточки</button></div>:row?<><h4>{customerName(row)}</h4><p>Идентификатор клиента: {row.customer.id}</p><p>{row.wallet?'Баланс: '+formatExact(row.wallet.balance)+' бонусов':'Бонусный кошелёк ещё не создан.'}</p></>:<p role="status">Проверяем карточку…</p>}
  </section>
}
