import {useEffect,useMemo,useRef,useState} from 'react'
import {ClipboardCopy,Download,PackagePlus,Search,ShieldAlert} from 'lucide-react'
import type {ApiVenue} from '../api'
import {PageHead} from '../ui'
import {BEER_CATALOG,filterBeerCatalog,parsePositiveLiters} from './beer-catalog'
import './beer-intake.css'

const formatLiters=(value:number)=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:3}).format(value)
type IntakeRow={name:string;liters:number}

/** Quick intake draft using manual, dated stock. Never claims to update Evotor. */
export function BeerIntake({venue}:{venue:ApiVenue}){
  const [query,setQuery]=useState('')
  const [selectedId,setSelectedId]=useState<string|null>(null)
  const [litersById,setLitersById]=useState<Record<string,string>>({})
  const [notice,setNotice]=useState('')
  const volumeInput=useRef<HTMLInputElement>(null)
  const matches=useMemo(()=>filterBeerCatalog(query),[query])
  const rows=useMemo<IntakeRow[]>(()=>BEER_CATALOG.flatMap(item=>{
    const liters=parsePositiveLiters(litersById[item.id]||'')
    return liters===null?[]:[{name:item.name,liters}]
  }),[litersById])
  const invalid=Object.values(litersById).filter(v=>v.trim()!==''&&parsePositiveLiters(v)===null).length
  const canExport=rows.length>0&&invalid===0
  const total=rows.reduce((sum,row)=>sum+row.liters,0)
  useEffect(()=>{if(selectedId)volumeInput.current?.focus()},[selectedId])
  function changeVolume(id:string,value:string){setLitersById(prev=>({...prev,[id]:value}));setNotice('')}
  function select(id:string){setSelectedId(id);setNotice('')}
  const summary=rows.map(row=>row.name+': +'+formatLiters(row.liters)+' л').join('\n')
  async function copySummary(){
    if(!canExport)return
    try{await navigator.clipboard.writeText(summary);setNotice('Сводка скопирована. Остатки Эвотора не изменены.')}
    catch{setNotice('Скопировать не удалось. Используйте CSV.')}
  }
  function exportCsv(){
    if(!canExport)return
    const csv='\uFEFFНазвание;Приход (л)\r\n'+rows.map(row=>[row.name,row.liters].map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(';')).join('\r\n')
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}))
    const link=document.createElement('a');link.href=url;link.download='PIVNIK-prihod-chernovik.csv';link.click()
    URL.revokeObjectURL(url)
    setNotice('Черновик выгружен. Это не документ Эвотора.')
  }
  return <div className="page beer-intake">
    <PageHead eyebrow="ПИВНИК · ПРИХОД" title="Добавить привоз" sub={venue.companyName+' → '+venue.name}/>
    <section className="card beer-intake-card">
      <div className="beer-intake-heading"><PackagePlus size={22}/><div><h3>Найди сорт и впиши литры</h3><p>Одно нажатие на сорт, затем сразу количество. Никаких отдельных карточек товаров.</p></div></div>
      <label className="beer-intake-label" htmlFor="beer-search">Поиск по названию</label>
      <div className="beer-intake-search"><Search size={18}/><input id="beer-search" type="search" autoComplete="off" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Хадыженское, Пилснер, Барное…"/></div>
      <p className="beer-intake-source">Сорта из инвентаризаций ПИВНИКА. Остатки указаны на 25.10.2026, не из Эвотора в реальном времени. Для части сортов остаток неизвестен.</p>
      <div className="beer-intake-products">
        {matches.length===0&&<p>Совпадений нет.</p>}
        {matches.map(item=>{
          const selected=selectedId===item.id
          const value=litersById[item.id]||''
          const parsed=parsePositiveLiters(value)
          const invalidVolume=value.trim()!==''&&parsed===null
          return <div className="beer-intake-item" key={item.id}>
            <button type="button" className={'beer-intake-choice'+(selected?' selected':'')} aria-expanded={selected} onClick={()=>select(item.id)}>
              <span className="beer-intake-name">{item.name}{parsed!==null&&<strong>+{formatLiters(parsed)} л</strong>}</span>
              <small>{item.balance===null?'Остаток неизвестен':item.balance}</small>
            </button>
            {selected&&<div className="beer-intake-inline">
              <span className="beer-intake-current">Последняя инвентаризация: <b>{item.balance??'нет данных'}</b>{item.countedAt?' · '+item.countedAt:''}</span>
              <label htmlFor={'intake-'+item.id}>Привоз, литры</label>
              <div className="beer-intake-volume"><input ref={volumeInput} id={'intake-'+item.id} inputMode="decimal" type="text" placeholder="Например, 50" value={value} aria-invalid={invalidVolume} onChange={event=>changeVolume(item.id,event.target.value)}/><span>л</span></div>
              {invalidVolume&&<small role="alert">Введите положительное количество в литрах, максимум 10 000.</small>}
              <small>Ввод сразу попадёт в список ниже. Никаких изменений в кассе.</small>
            </div>}
          </div>
        })}
      </div>
      <div className="beer-intake-summary"><div><strong>Привоз: {rows.length} сортов</strong><span>Всего +{formatLiters(total)} л</span></div><div className="beer-intake-actions">
        <button type="button" className="btn secondary" disabled={!canExport} onClick={()=>void copySummary()}><ClipboardCopy size={16}/>Копировать</button>
        <button type="button" className="btn secondary" disabled={!canExport} onClick={exportCsv}><Download size={16}/>CSV</button>
      </div></div>
      {notice&&<p role="status">{notice}</p>}
    </section>
    <div className="safety-note beer-intake-warning"><ShieldAlert size={18}/><span><b>Черновик, не товароучёт.</b> В этой версии ввод подготавливает список поступления, но не меняет реальные остатки Эвотора. Для проведения нужны проверенное сопоставление карточек, права и защита от повторной записи.</span></div>
  </div>
}
