import {useEffect,useRef,useState} from 'react'
import {apiGet,ApiError} from '../api'
import {customerName,customerWallet,directoryPage,formatExact,verifiedEnvelope,type CustomerWallet,type DirectoryPage,type Scope} from './tenant-crm-contract'
import './tenant-crm-directory.css'

interface Props {actorId:string;draftId:string;scope:Scope}
function message(error:unknown){
  if(error instanceof ApiError){
    if(error.status===401)return 'Сессия истекла. Войдите снова.'
    if(error.status===403)return 'Проверка недоступна или у вас нет доступа к клиентам этого заведения.'
    if(error.code==='TENANT_CRM_SOURCE_NOT_CONFIGURED')return 'Источник клиентских данных ещё не подключён.'
    if(error.status===429)return 'Слишком частые проверки. Повторите через минуту.'
  }
  return 'Не удалось подтвердить данные этого заведения. Повторите проверку.'
}
export function TenantCustomerDirectory(props:Props){
  return <Directory key={`${props.actorId}:${props.draftId}:${props.scope.companyId}:${props.scope.venueId}`} {...props}/>
}
function Directory({draftId,scope}:Props){
  const {companyId,venueId}=scope
  const [started,setStarted]=useState(false),[query,setQuery]=useState(''),[q,setQ]=useState(''),[offset,setOffset]=useState(0)
  const [page,setPage]=useState<DirectoryPage|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0)
  const [selected,setSelected]=useState<{id:string;revision:number}|null>(null)
  const sequence=useRef(0),selection=useRef(0),limit=25
  const path=`/api/admin/onboarding/drafts/${encodeURIComponent(draftId)}/crm/customers`
  useEffect(()=>{
    if(!started)return
    let cancelled=false;const current=++sequence.current
    setLoading(true);setPage(null);setError('')
    const request={q,limit,offset},params=new URLSearchParams({q,limit:String(limit),offset:String(offset)})
    void apiGet<unknown>(path+'?'+params).then(raw=>{
      if(!cancelled&&current===sequence.current)setPage(directoryPage(raw,{companyId,venueId},request))
    }).catch(error=>{if(!cancelled&&current===sequence.current)setError(message(error))})
      .finally(()=>{if(!cancelled&&current===sequence.current)setLoading(false)})
    return()=>{cancelled=true}
  },[path,companyId,venueId,started,q,offset,revision])
  function change(nextQ:string,nextOffset:number){
    sequence.current++;setPage(null);setSelected(null);setError('');setLoading(true)
    setQ(nextQ);setOffset(nextOffset);setRevision(value=>value+1);setStarted(true)
  }
  return <section className="tenant-crm" aria-label="Проверка клиентской базы">
    <h3>Клиентская база</h3>
    <p>Проверьте доступ к клиентам этого заведения. Связь с кассой проверяется отдельно.</p>
    {!started&&<button type="button" className="btn" onClick={()=>change('',0)}>Проверить клиентскую базу</button>}
    {started&&<>
      <form className="tenant-crm-search" onSubmit={event=>{event.preventDefault();change(query.trim(),0)}}>
        <label className="field"><span>Найти клиента</span><input maxLength={100} value={query} onChange={event=>setQuery(event.target.value)} placeholder="Имя или идентификатор"/></label>
        <button className="btn" disabled={loading}>Найти</button>
        <button className="btn secondary" type="button" disabled={loading} onClick={()=>change(q,offset)}>Обновить</button>
      </form>
      {loading&&<p role="status">Проверяем клиентскую базу…</p>}
      {error&&<p role="alert">{error}</p>}
      {page&&<>
        <p role="status">Доступ к клиентской базе проверен. Найдено клиентов: {formatExact(page.total)}.</p>
        {page.items.length===0?<p>{q?'Клиенты не найдены. Измените поисковый запрос.':'Клиентов пока нет.'}</p>:
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
  const [row,setRow]=useState<CustomerWallet|null>(null),[error,setError]=useState('')
  useEffect(()=>{
    let cancelled=false
    void apiGet<unknown>(path+'/'+encodeURIComponent(id)).then(raw=>{
      const value=verifiedEnvelope(raw,{companyId,venueId}),next=customerWallet(value)
      if(next.customer.id!==id)throw new Error('Customer mismatch')
      if(!cancelled)setRow(next)
    }).catch(error=>{if(!cancelled)setError(message(error))})
    return()=>{cancelled=true}
  },[path,id,companyId,venueId])
  return <section className="tenant-crm-card" aria-label="Карточка клиента">
    <button type="button" className="btn secondary" onClick={onClose}>Закрыть карточку</button>
    {error?<p role="alert">{error}</p>:row?<><h4>{customerName(row)}</h4><p>{row.wallet?'Баланс: '+formatExact(row.wallet.balance)+' бонусов':'Бонусный кошелёк ещё не создан.'}</p></>:<p role="status">Проверяем карточку…</p>}
  </section>
}
