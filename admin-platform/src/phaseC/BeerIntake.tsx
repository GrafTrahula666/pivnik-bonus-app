import {useEffect,useMemo,useRef,useState} from 'react'
import {PackagePlus,RefreshCw,Search} from 'lucide-react'
import {apiGet,apiPost,type ApiVenue} from '../api'
import {PageHead} from '../ui'
import {BEER_CATALOG,beerSearchKey,parsePositiveLiters} from './beer-catalog'
import './beer-intake.css'

type Product={id:string;name:string;quantity:number;measure_name:string;updated_at:string;store_id:string;type:string}
type CatalogResponse={source:'evotor_cloud';writeEnabled:boolean;writeBlock?:{code:string;message:string};products:Product[]}
type AddResponse={ok:true;alreadyApplied:boolean;recordedLiters:number;source:'evotor_cloud'}
const litersText=(value:number)=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:3}).format(value)
const aliasesFor=(name:string)=>BEER_CATALOG.find(item=>beerSearchKey(item.name)===beerSearchKey(name))?.aliases??[]

export function BeerIntake({venue}:{venue:ApiVenue}){
  const [query,setQuery]=useState('')
  const [selected,setSelected]=useState<string|null>(null)
  const [liters,setLiters]=useState('')
  const [catalog,setCatalog]=useState<CatalogResponse|null>(null)
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const pendingOperation=useRef<string|null>(null)
  const volumeInput=useRef<HTMLInputElement>(null)
  const base='/api/admin/venues/'+venue.id+'/beer-intake'
  const refresh=()=>{
    setLoading(true)
    apiGet<CatalogResponse>(base).then(data=>{
      if(data.source!=='evotor_cloud'||!Array.isArray(data.products))throw new Error('Получены не кассовые остатки. Запись заблокирована.')
      setCatalog(data);setError('')
    }).catch(e=>{setCatalog(null);setError(e instanceof Error?e.message:'Не удалось получить остатки Эвотора.')})
      .finally(()=>setLoading(false))
  }
  useEffect(()=>{
    let cancelled=false
    setLoading(true)
    apiGet<CatalogResponse>(base).then(data=>{
      if(data.source!=='evotor_cloud'||!Array.isArray(data.products))throw new Error('Получены не кассовые остатки.')
      if(!cancelled){setCatalog(data);setError('')}
    }).catch(e=>{if(!cancelled){setCatalog(null);setError(e instanceof Error?e.message:'Нет доступа к Эвотору.')}})
      .finally(()=>{if(!cancelled)setLoading(false)})
    return()=>{cancelled=true}
  },[base])
  const products=useMemo(()=>{
    const needle=beerSearchKey(query)
    const all=catalog?.products??[]
    if(!needle)return all
    return all.filter(p=>[p.name,...aliasesFor(p.name)].some(text=>beerSearchKey(text).includes(needle)))
  },[query,catalog])
  const product=catalog?.products.find(item=>item.id===selected)
  const parsed=parsePositiveLiters(liters)
  useEffect(()=>{if(product)volumeInput.current?.focus()},[product?.id])
  function select(id:string){setSelected(id);setLiters('');setError('');setNotice('');pendingOperation.current=null}
  function changeVolume(next:string){setLiters(next);setNotice('');pendingOperation.current=null}
  async function add(){
    if(!product||parsed===null||saving||loading||!catalog?.writeEnabled)return
    const operationId=pendingOperation.current??crypto.randomUUID()
    pendingOperation.current=operationId
    setSaving(true);setNotice('');setError('')
    try{
      const result=await apiPost<AddResponse>(base,{productId:product.id,liters:parsed,operationId,
        expectedQuantity:product.quantity,expectedUpdatedAt:product.updated_at})
      if(!result.ok||result.source!=='evotor_cloud')throw new Error('Эвотор не подтвердил изменение остатка.')
      setCatalog(previous=>previous?{...previous,products:previous.products.map(item=>item.id===product.id?
        {...item,quantity:result.recordedLiters,updated_at:''}:item)}:previous)
      setNotice(result.alreadyApplied?'Этот привоз уже был проведён в Эвоторе. Повторно ничего не добавлено.':
        'Эвотор подтвердил: '+litersText(result.recordedLiters)+' л в облаке.')
      setLiters('');pendingOperation.current=null
      // Read a new version before any further increase of this product.
      setSelected(null)
      refresh()
    }catch(e){
      setError(e instanceof Error?e.message:'Не удалось подтвердить запись в Эвотор.')
    }finally{setSaving(false)}
  }
  return <div className="page beer-intake">
    <PageHead eyebrow="ЭВОТОР · ОСТАТКИ" title="Добавить литры в кассу" sub={venue.companyName+' → '+venue.name}
      actions={<button type="button" className="btn secondary" disabled={loading||saving} onClick={refresh}><RefreshCw size={16}/>Обновить</button>}/>
    <section className="card beer-intake-card">
      <div className="beer-intake-heading"><PackagePlus size={22}/><div><h3>Найди сорт, введи литры и добавь</h3><p>Остатки загружаются непосредственно из Облака Эвотор.</p></div></div>
      <label className="beer-intake-label" htmlFor="beer-search">Поиск товара</label>
      <div className="beer-intake-search"><Search size={18}/><input id="beer-search" type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Например, Хадыженское"/></div>
      {loading&&<p role="status">Проверяю остатки в Эвоторе…</p>}
      {error&&<p role="alert">{error}</p>}
      {notice&&<p role="status">{notice}</p>}
      {catalog&&!catalog.writeEnabled&&<p role="status">{catalog.writeBlock?.message||'Просмотр доступен, но запись в Эвотор пока не включена.'}</p>}
      <div className="beer-intake-products">
        {!loading&&catalog&&products.length===0&&<p>Сортов в литрах по запросу не найдено. Проверьте название и единицу измерения товара в Эвоторе.</p>}
        {products.map(item=>{
          const open=item.id===selected
          return <div className="beer-intake-item" key={item.id}>
            <button type="button" className={'beer-intake-choice'+(open?' selected':'')} onClick={()=>select(item.id)} aria-expanded={open} disabled={loading||saving}>
              <span className="beer-intake-name">{item.name}</span>
              <small>В Эвоторе: {litersText(item.quantity)} л</small>
            </button>
            {open&&<div className="beer-intake-inline">
              <span className="beer-intake-current">Сейчас в Эвоторе: <b>{litersText(item.quantity)} л</b></span>
              <label htmlFor="beer-volume">Добавить литров</label>
              <div className="beer-intake-volume"><input ref={volumeInput} id="beer-volume" inputMode="decimal" type="text" value={liters}
                placeholder="50" onChange={e=>changeVolume(e.target.value)} disabled={saving}/><span>л</span></div>
              {parsed!==null&&<span>Станет: <b>{litersText(item.quantity+parsed)} л</b></span>}
              <button type="button" className="btn" disabled={parsed===null||loading||saving||!catalog?.writeEnabled} onClick={()=>void add()}>
                {saving?'Проверяю кассу…':'Добавить в Эвотор'}</button>
            </div>}
          </div>
        })}
      </div>
      <p className="beer-intake-source">Только товары, учитываемые в литрах. Запись происходит в Облаке Эвотор. Появление остатка на терминале зависит от синхронизации кассы.</p>
    </section>
  </div>
}
