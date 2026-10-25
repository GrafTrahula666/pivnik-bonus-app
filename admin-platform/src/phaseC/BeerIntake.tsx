import {useEffect,useMemo,useRef,useState} from 'react'
import {PackagePlus,Search} from 'lucide-react'
import {apiGet,apiPost,type ApiVenue} from '../api'
import {PageHead} from '../ui'
import {filterBeerCatalog,parsePositiveLiters} from './beer-catalog'
import './beer-intake.css'

type StockResponse={source:'admin_arrivals_only';balances:Record<string,number>}
type AddResponse={ok:true;recordedLiters:number;alreadyApplied:boolean}
const formatLiters=(value:number)=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:3}).format(value)

export function BeerIntake({venue}:{venue:ApiVenue}){
  const [query,setQuery]=useState('')
  const [selected,setSelected]=useState<string|null>(null)
  const [liters,setLiters]=useState('')
  const [balances,setBalances]=useState<Record<string,number>>({})
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const pendingOperation=useRef<string|null>(null)
  const volumeInput=useRef<HTMLInputElement>(null)
  const matches=useMemo(()=>filterBeerCatalog(query),[query])
  const parsed=parsePositiveLiters(liters)
  const base='/api/admin/venues/'+venue.id+'/beer-intake'
  useEffect(()=>{
    let cancelled=false
    apiGet<StockResponse>(base).then(data=>{if(!cancelled){setBalances(data.balances);setError('')}})
      .catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:'Не удалось открыть учёт поступлений.')})
      .finally(()=>{if(!cancelled)setLoading(false)})
    return()=>{cancelled=true}
  },[base])
  useEffect(()=>{if(selected)volumeInput.current?.focus()},[selected])
  function select(id:string){setSelected(id);setLiters('');setError('');setNotice('');pendingOperation.current=null}
  function edit(value:string){setLiters(value);setNotice('');pendingOperation.current=null}
  async function add(){
    if(!selected||parsed===null||saving||loading)return
    const operationId=pendingOperation.current??crypto.randomUUID()
    pendingOperation.current=operationId
    setSaving(true);setNotice('');setError('')
    try{
      const result=await apiPost<AddResponse>(base,{productId:selected,liters:parsed,operationId})
      if(!result.ok)throw new Error('Поступление не подтверждено сервером.')
      setBalances(previous=>({...previous,[selected]:result.recordedLiters}))
      setNotice(result.alreadyApplied?'Это поступление уже было учтено. Повторно литры не добавлены.':'Добавлено '+formatLiters(parsed)+' л.')
      setLiters('')
      pendingOperation.current=null
    }catch(e){setError(e instanceof Error?e.message:'Не удалось добавить литры. Попробуйте ещё раз.')}
    finally{setSaving(false)}
  }
  return <div className="page beer-intake">
    <PageHead eyebrow="ПИВНИК · ИНВЕНТАРИЗАЦИЯ" title="Добавить литры" sub={venue.companyName+' → '+venue.name}/>
    <section className="card beer-intake-card">
      <div className="beer-intake-heading"><PackagePlus size={22}/><div><h3>Выберите сорт и добавьте литры</h3><p>Поиск → сорт → количество → добавить.</p></div></div>
      <label className="beer-intake-label" htmlFor="beer-search">Название пива</label>
      <div className="beer-intake-search"><Search size={18}/><input id="beer-search" type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Например, Хадыженское"/></div>
      {loading&&<p role="status">Загружаем остатки…</p>}
      {!loading&&error&&!selected&&<p role="alert">{error}</p>}
      <div className="beer-intake-products">
        {!matches.length&&<p>Совпадений нет.</p>}
        {matches.map(item=>{
          const open=item.id===selected
          return <div className="beer-intake-item" key={item.id}>
            <button type="button" className={'beer-intake-choice'+(open?' selected':'')} onClick={()=>select(item.id)} aria-expanded={open} disabled={loading}>
              <span className="beer-intake-name">{item.name}</span>
              <small>{item.balance??'Остаток не указан'}</small>
            </button>
            {open&&<div className="beer-intake-inline">
              <span className="beer-intake-current">Последняя инвентаризация: <b>{item.balance??'нет данных'}</b> · 25.10.2026</span>
              <span className="beer-intake-current">Добавлено через CRM: <b>{formatLiters(balances[item.id]??0)} л</b> (с запуска функции, не фактический остаток)</span>
              <label htmlFor="beer-volume">Добавить литров</label>
              <div className="beer-intake-volume"><input ref={volumeInput} id="beer-volume" inputMode="decimal" type="text" placeholder="50" value={liters} onChange={event=>edit(event.target.value)} disabled={saving}/><span>л</span></div>
              <button type="button" className="btn" disabled={parsed===null||loading||saving} onClick={()=>void add()}>{saving?'Добавляем…':'Добавить'}</button>
              {error&&<small role="alert">{error}</small>}
              {notice&&<small role="status">{notice}</small>}
            </div>}
          </div>
        })}
      </div>
      <p className="beer-intake-source">Данные исходной инвентаризации приблизительные. Новые поступления сохраняются отдельно в CRM. Остатки Эвотора не меняются.</p>
    </section>
  </div>
}
