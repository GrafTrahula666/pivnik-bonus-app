import { useState } from 'react'
import type { PosSummary } from '../../../pos/analytics.js'
import { CircleHelp,Database } from 'lucide-react'
import { CardTitle,cn,rub } from '../ui'

import type { CashReport } from './cash-report'
export type { CashReport } from './cash-report'

function cashMoney(cents:string|null|undefined){
  if(cents===null||cents===undefined)return 'Нет данных'
  const value=BigInt(cents),absolute=value<0n?-value:value
  return `${value<0n?'−':''}₽ ${(absolute/100n).toLocaleString('ru-RU')},${String(absolute%100n).padStart(2,'0')}`
}

function CashKpi({label,value,source}:{label:string;value:string;source:string}){
  const available=value!=='Нет данных'
  return <div className={cn('kpi card live-kpi',!available&&'kpi-unavailable')}>
    <div className="kpi-top"><span>{label}</span><span className="ghost-icon info-icon" role="img" aria-label="Источник метрики" title={source}><CircleHelp size={14}/></span></div>
    <div className="kpi-value">{value}</div>
    <div className="kpi-reason">{source}</div>
  </div>
}


type CashProduct=NonNullable<PosSummary['products']>[number]
type ProductSort='revenue'|'quantity'|'returns'

function cashQuantity(value:string,measure:string){
  const millis=BigInt(value),absolute=millis<0n?-millis:millis
  const decimals=String(absolute%1000n).padStart(3,'0').replace(/0+$/,'')
  return (millis<0n?'−':'')+(absolute/1000n).toLocaleString('ru-RU')+(decimals?','+decimals:'')+(measure?' '+measure:'')
}
function cashAbs(value:bigint){return value<0n?-value:value}

function CashInsights({summary}:{summary:PosSummary}){
  const [query,setQuery]=useState('')
  const [sort,setSort]=useState<ProductSort>('revenue')
  const [limit,setLimit]=useState(10)
  const hours=summary.hours
  const maximum=(hours||[]).reduce((largest,row)=>{
    const value=cashAbs(BigInt(row.amountCents))
    return value>largest?value:largest
  },0n)
  const products=summary.products
  const filtered=(products||[]).filter(p=>p.name.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')))
  const metric=(p:CashProduct)=>BigInt(sort==='quantity'?p.quantityMillis:sort==='returns'?p.returnCents:p.netCents)
  const ordered=[...filtered].sort((a,b)=>{
    const x=metric(a),y=metric(b)
    return x===y?a.name.localeCompare(b.name,'ru'):x>y?-1:1
  })
  return <div className="cash-insights">
    <section className="card cash-insight-section">
      <div className="cash-insight-heading"><div><span className="eyebrow">КАССА · ВРЕМЯ</span><h3>Выручка по часам</h3></div>
        <small>С учётом возвратов · время Москвы</small></div>
      {hours===undefined?<p className="cash-insight-empty">Нет данных о продажах по часам.</p>:
       hours.length===0?<p className="cash-insight-empty">В выбранном периоде нет почасовых операций.</p>:
       <div className="cash-hours-list" role="list" aria-label="Выручка по часам">
         {[...hours].sort((a,b)=>a.label.localeCompare(b.label)).map(row=>{
           const amount=BigInt(row.amountCents)
           const width=maximum===0n?0:Number(cashAbs(amount)*100n/maximum)
           return <div className="cash-hour-row" role="listitem" key={row.label}>
             <span className="cash-hour-time">{row.label}:00</span>
             <div className="cash-hour-track"><div className={'cash-hour-fill'+(amount<0n?' negative':'')} style={{width:width+'%'}}/></div>
             <b className="cash-hour-value">{cashMoney(row.amountCents)}</b>
           </div>
         })}
       </div>}
      <p className="cash-insight-note">Отображаются часы с кассовыми документами; отрицательные значения означают превышение возвратов над продажами.</p>
    </section>
    <section className="card cash-insight-section">
      <div className="cash-insight-heading"><div><span className="eyebrow">КАССА · АССОРТИМЕНТ</span><h3>Продажи по товарам</h3></div>
        <small>Суммы после скидок · с учётом возвратов</small></div>
      {products===undefined?<p className="cash-insight-empty">Нет данных о товарных позициях.</p>:
       products.length===0?<p className="cash-insight-empty">В выбранном периоде нет товарных операций.</p>:
       <>
         <div className="cash-product-controls">
           <input aria-label="Поиск товара" type="search" placeholder="Поиск товара" value={query}
             onChange={e=>{setQuery(e.target.value);setLimit(10)}}/>
           <label>Сортировка
             <select aria-label="Сортировка товаров" value={sort} onChange={e=>{setSort(e.target.value as ProductSort);setLimit(10)}}>
               <option value="revenue">По выручке</option>
               <option value="quantity">По количеству</option>
               <option value="returns">По возвратам</option>
             </select>
           </label>
         </div>
         <div className="table-scroll">
           <table className="cash-product-table"><thead><tr>
             <th>Товар</th><th>Количество</th><th>Продажи</th><th>Возвраты</th><th>Выручка</th>
           </tr></thead><tbody>
             {ordered.slice(0,limit).map((p,index)=><tr key={p.name+'|'+p.measure+'|'+index}>
               <td>{p.name}</td><td>{cashQuantity(p.quantityMillis,p.measure)}</td>
               <td>{cashMoney(p.salesCents)}</td><td>{cashMoney(p.returnCents)}</td>
               <td><strong>{cashMoney(p.netCents)}</strong></td>
             </tr>)}
             {ordered.length===0&&<tr><td colSpan={5}>Товары не найдены</td></tr>}
           </tbody></table>
         </div>
         <div className="cash-product-footer"><span>Показано {Math.min(limit,ordered.length)} из {ordered.length}</span>
           {ordered.length>limit&&<button type="button" className="btn secondary" onClick={()=>setLimit(n=>n+20)}>Показать ещё</button>}
         </div>
       </>}
      <p className="cash-insight-note">Количество — проданное за вычетом возвращённого. Прибыль не рассчитывается: себестоимости в этих документах нет.</p>
    </section>
  </div>
}

export function CashDashboard({report,mode='all',loading=false,error=''}:{report?:CashReport;mode?:'all'|'app';loading?:boolean;error?:string}){
  const readable=Boolean(report?.connection.lastSuccessAt)&&!['not_connected','schema_required'].includes(report?.connection.state||'')
  const all=readable?(mode==='app'?report?.app:report?.all):null
  const count=(n:number|null|undefined)=>n===null||n===undefined?'Нет данных':rub.format(n)
  const state=report?.connection.state
  // The app re-reads the whole cash history every couple of minutes; after one full pass a running
  // pass is routine, the totals are those of the last full pass.
  const refreshing=state==='syncing'&&Boolean(report?.connection.lastSuccessAt)
  const status=error?'Не удалось обновить кассу':loading?'Обновляем кассу':state==='error'?'Не удалось обновить кассу':state==='syncing'&&!refreshing?'Идёт первая загрузка кассы':state==='awaiting_sync'?'Ожидаем загрузку кассы':all?'Данные Эвотора':'Касса не подключена'
  const kpis=[
    ['Выручка',cashMoney(all?.netCents),'Продажи за вычетом возвратов'],
    ['Средний чек',cashMoney(all?.averageCents),'Сумма продаж / число чеков продажи'],
    ['Чеков продажи',count(all?.receiptCount),'Подтверждённые кассовые чеки'],
    ['Операций',all?count(all.saleDocuments+all.returnDocuments):'Нет данных','Документы продажи и возврата'],
    ['Сумма продаж',cashMoney(all?.salesCents),'После скидок, до вычета возвратов'],
    ['Сумма возвратов',cashMoney(all?.returnsCents),'Возвраты уменьшают выручку'],
    ['Продаж',count(all?.saleDocuments),'Закрытые продажи кассы'],
    ['Возвратов',count(all?.returnDocuments),'Закрытые возвраты кассы'],
  ]
  const tables=all?[
    {title:'Выручка по дням',label:'Дата',rows:all.days},
    {title:'Способы оплаты',label:'Оплата',rows:all.payments},
  ]:[]
  if(mode==='app'){
    const app=all as PosSummary|null|undefined
    kpis.push(['Покупателей',count(app?.activeBuyers),'Только достоверно связанные SELL периода'],
      ['Повторных покупателей',count(app?.repeatBuyers),'Не менее двух связанных продаж в периоде'],
      ['Повторные покупки',app?.repeatPurchaseRate==null?'Нет данных':app.repeatPurchaseRate+'%','Покупатели с 2+ покупками / все покупатели периода'],
      ['Частота покупок',app?.purchaseFrequency==null?'Нет данных':app.purchaseFrequency.toFixed(2),'Связанные продажи / покупатели периода'])
  }
  return <div className="page cash-dashboard">
    <section className="card data-quality-card" aria-live="polite"><div><Database/><div><b>{status}</b><span>{mode==='app'?'Только подтверждённые чеки клиентов PIVNIK. Это часть общей кассы. Суммы не складываются.':all?'Все покупки, включая гостей без приложения. Клиентские чеки уже входят в этот итог.':'Кассовые показатели появятся после подключения Эвотора и полной загрузки. Данные программы лояльности здесь не используются.'}</span></div></div>
      {(error||loading)&&report&&<p className="comparison-note">{error||'Запрос выполняется.'} Показаны предыдущие данные. Не обновлено.</p>}
      {state==='syncing'&&!refreshing&&<p className="comparison-note">Первая загрузка ещё идёт. Данные могут быть неполными.</p>}
      {refreshing&&<p className="comparison-note">Касса обновляется каждые пару минут. Цифры — на момент последней полной сверки, новые чеки появятся со следующей.</p>}
      {report?.period&&<p className="comparison-note">Период: {new Date(report.period.from).toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow'})} — {new Date(Date.parse(report.period.until)-1).toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow'})}. Границы дня — по Москве.</p>}
      {report?.connection.lastSuccessAt&&<p className="comparison-note">Последняя полная сверка: {new Date(report.connection.lastSuccessAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})}. Время — по Москве.</p>}
    </section>
    <div className="kpi-grid">{kpis.map(([label,value,source])=><CashKpi key={label} label={label} value={value} source={source}/>)}</div>
    {mode==='all'&&all&&report?.app&&report.unlinked&&<section className="card cash-split">
      <h3>Внутри общей кассы</h3>
      <p>Клиенты PIVNIK: <b>{cashMoney(report.app.salesCents)}</b> · {report.linkedRevenueSharePercent==null?'Нет базы для доли':report.linkedRevenueSharePercent+'% суммы продаж'}</p>
      <p>Без связи с PIVNIK: <b>{cashMoney(report.unlinked.salesCents)}</b></p>
      <small>Суммы продаж до возвратов. Клиентские продажи уже включены в общий итог.</small>
    </section>}
    {all&&<div className="two-cols">
      {tables.map(({title,label,rows})=><section className="card table-card" key={title}>
        <div className="table-section-title"><CardTitle title={title}/></div>
        <div className="table-scroll"><table><thead><tr><th>{label}</th><th>С учётом возвратов</th></tr></thead>
          <tbody>{rows.length?rows.map(row=><tr key={row.label}><td>{row.label}</td><td><strong>{cashMoney(row.amountCents)}</strong></td></tr>):<tr><td colSpan={2}>За период нет данных</td></tr>}</tbody></table></div>
      </section>)}
    </div>}
    {mode==='all'&&all&&<CashInsights summary={all}/>}
  </div>
}
