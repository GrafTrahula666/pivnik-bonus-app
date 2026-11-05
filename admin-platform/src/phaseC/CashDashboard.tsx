import { useEffect,useRef,useState,type ReactNode } from 'react'
import { cashMoney,cashPercentDelta } from './cash-format'
import type { CashComparisonSnapshot } from './CashComparison'
import type { PosSummary } from '../../../pos/analytics.js'
import { CircleHelp,Database } from 'lucide-react'
import { CardTitle,cn,rub } from '../ui'

import type { CashReport } from './cash-report'
import { SortTh, sortTableRows, type SortDirection } from './TableSort'
export type { CashReport } from './cash-report'


function CashKpi({label,value,source,trend,trendPeriod}:{label:string;value:string;source:string;trend?:string|null;trendPeriod?:string}){
  const available=value!=='Нет данных'
  return <div className={cn('kpi card live-kpi',!available&&'kpi-unavailable')}>
    <div className="kpi-top"><span>{label}</span><span className="ghost-icon info-icon" role="img" aria-label="Источник метрики" title={source}><CircleHelp size={14}/></span></div>
    <div className="kpi-value">{value}</div>
    <div className="kpi-reason">{source}</div>
    {trend&&<div className="cash-kpi-trend" aria-label={`Изменение к ${trendPeriod}: ${trend}`}>Изменение: <b>{trend}</b><span>к {trendPeriod}</span></div>}
  </div>
}


type CashProduct=NonNullable<PosSummary['products']>[number]
type ProductSort='name'|'revenue'|'quantity'|'sales'|'returns'

function cashQuantity(value:string,measure:string){
  const millis=BigInt(value),absolute=millis<0n?-millis:millis
  const decimals=String(absolute%1000n).padStart(3,'0').replace(/0+$/,'')
  return (millis<0n?'−':'')+(absolute/1000n).toLocaleString('ru-RU')+(decimals?','+decimals:'')+(measure?' '+measure:'')
}
function cashAbs(value:bigint){return value<0n?-value:value}

// A POS receipt must be confirmed before it can contribute to the linked-client share.
// BigInt avoids precision loss on large, but individually safe, receipt counters.
function linkedReceiptShare(linked:number|null|undefined,total:number|null|undefined):number|null{
  if(linked==null||total==null||!Number.isSafeInteger(linked)||!Number.isSafeInteger(total)||
    total<=0||linked<0||linked>total)return null
  return Number((BigInt(linked)*10000n+BigInt(total)/2n)/BigInt(total))/100
}
function CashShareMetric({label,percent,note}:{label:string;percent:number|null|undefined;note:string}){
  const value=typeof percent==='number'&&Number.isFinite(percent)&&percent>=0&&percent<=100?percent:null
  return <div className="cash-share-metric">
    <span>{label}</span><strong>{value===null?'Нет данных':value.toLocaleString('ru-RU',{maximumFractionDigits:2})+'%'}</strong>
    {value===null?<div className="cash-share-missing">Нет подтверждённой базы для расчёта</div>:
      <div className="cash-share-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}><div style={{width:value+'%'}}/></div>}
    <small>{note}</small>
  </div>
}

function CashHourlyChart({hours,daily=false}:{hours:NonNullable<PosSummary['hours']>;daily?:boolean}){
  const [active,setActive]=useState<string|null>(null)
  const figure=useRef<HTMLElement>(null),[width,setWidth]=useState(960)
  useEffect(()=>{
    const element=figure.current
    if(!element)return
    const resize=()=>setWidth(Math.max(240,Math.round(element.clientWidth-24)))
    resize()
    const observer=new ResizeObserver(resize);observer.observe(element)
    return()=>observer.disconnect()
  },[])
  const step=(width-38)/Math.max(1,daily?hours.length:24)
  const barWidth=Math.max(.5,Math.min(40,step*.65))
  const amounts=new Map(hours.map(row=>[row.label,row.amountCents]))
  const rows=daily?hours:Array.from({length:24},(_,hour)=>({label:String(hour).padStart(2,'0'),amountCents:amounts.get(String(hour).padStart(2,'0'))||'0'}))
  const dateLabel=(value:string)=>new Date(value+'T00:00:00+03:00').toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit'})
  const rowLabel=(value:string)=>daily?dateLabel(value):`${value}:00–${value}:59`
  const values=rows.map(row=>BigInt(row.amountCents))
  const maximum=values.reduce((a,b)=>b>a?b:a,0n),minimum=values.reduce((a,b)=>b<a?b:a,0n)
  const span=maximum-minimum||1n
  // Only normalized geometry becomes a Number; financial labels retain exact cents.
  const y=(amount:bigint)=>208-Number((amount-minimum)*16800n/span)/100
  const zero=y(0n)
  const selected=rows.find(row=>row.label===active)
  const peak=rows.find(row=>BigInt(row.amountCents)===maximum)
  return <figure ref={figure} className="cash-hour-chart">
    <div className="cash-chart-detail" aria-live="polite">
      {selected?<><span>{rowLabel(selected.label)}</span><b>{cashMoney(selected.amountCents)}</b></>:
        maximum>0n?<><span>Самый доходный {daily?'день':'час'} · {peak?rowLabel(peak.label):''}</span><b>{cashMoney(String(maximum))}</b></>:
        <span>Наведите на {daily?'день':'час'} или выберите его клавишей Tab</span>}
    </div>
    <svg viewBox={`0 0 ${width} 254`} role="group" aria-label={daily?"График выручки по дням":"Почасовой график выручки, 24 часа"}>
      {[40,124,208].map(line=><line key={line} x1="28" x2={width-10} y1={line} y2={line} stroke="var(--border)" strokeDasharray="4 5"/>)}
      <line x1="28" x2={width-10} y1={zero} y2={zero} stroke="var(--muted)"/>
      <text x="4" y="30" fill="var(--muted)" fontSize="12">₽</text>
      {rows.map((row,index)=>{
        const amount=BigInt(row.amountCents),top=Math.min(zero,y(amount)),height=Math.abs(zero-y(amount))
        const label=`${rowLabel(row.label)} · ${cashMoney(row.amountCents)}`
        return <g key={row.label} tabIndex={0} role="img" aria-label={label} data-cash-hour={daily?undefined:row.label} data-cash-day={daily?row.label:undefined}
          className={'cash-chart-hour'+(active===row.label?' selected':'')}
          onClick={()=>setActive(row.label)} onMouseEnter={()=>setActive(row.label)} onMouseLeave={()=>setActive(null)} onFocus={()=>setActive(row.label)} onBlur={()=>setActive(null)}>
          <title>{label}</title>
          <rect x={28+index*step} y="35" width={step} height="179" fill="transparent"/>
          <rect className="cash-chart-bar" x={28+index*step+(step-barWidth)/2} y={amount===0n?zero-1:top} width={barWidth} height={Math.max(height,2)} rx="3"
            fill={amount<0n?'var(--danger)':'var(--accent)'} opacity={amount===0n?.3:1}/>
          <text x={28+index*step+step/2} y="238" textAnchor="middle" fill="var(--muted)" fontSize="12">{index%Math.max(1,Math.ceil(rows.length/(width>=600?16:5)))===0?(daily?dateLabel(row.label):row.label):''}</text>
        </g>
      })}
    </svg>
    <figcaption>{daily?'Календарные дни':'Час дня'}, МСК · возвраты показаны ниже нуля</figcaption>
  </figure>
}

function CashInsights({summary,period,cohort}:{summary:PosSummary;period:CashReport['period'];cohort:'all'|'app'}){
  const [query,setQuery]=useState('')
  const [grouping,setGrouping]=useState<'hours'|'days'>('hours')
  const [sort,setSort]=useState<ProductSort>('revenue')
  const [direction,setDirection]=useState<SortDirection>('desc')
  const [limit,setLimit]=useState(10)
  const changeSort=(column:string,next:SortDirection)=>{setSort(column as ProductSort);setDirection(next);setLimit(10)}
  const hours=summary.hours
  const maximum=(hours||[]).reduce((largest,row)=>{
    const value=cashAbs(BigInt(row.amountCents))
    return value>largest?value:largest
  },0n)
  const products=summary.products
  const filtered=(products||[]).filter(p=>p.name.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')))
  const ordered=sortTableRows(filtered,(p:CashProduct)=>sort==='name'?p.name:BigInt(sort==='quantity'?p.quantityMillis:sort==='returns'?p.returnCents:sort==='sales'?p.salesCents:p.netCents),direction)
  const dateLabel=(value:number)=>new Date(value).toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow'})
  const from=period?dateLabel(Date.parse(period.from)):null
  const until=period?dateLabel(Date.parse(period.until)-1):null
  return <div className="cash-insights">
    <section className="card cash-insight-section">
      <div className="cash-insight-heading"><div><span className="eyebrow">КАССА · ВРЕМЯ</span><h3>{(grouping==='hours'?'Выручка по часам':'Выручка по дням')+(cohort==='app'?' · PIVNIK':'')}</h3></div>
        <small>С учётом возвратов · время Москвы</small></div>
      <div className="segmented cash-chart-grouping" role="group" aria-label="Группировка графика выручки">
        <button type="button" aria-pressed={grouping==='hours'} className={grouping==='hours'?'active':''} onClick={()=>setGrouping('hours')}>По часам</button>
        <button type="button" aria-pressed={grouping==='days'} className={grouping==='days'?'active':''} onClick={()=>setGrouping('days')}>По дням</button>
      </div>
      <p className="cash-insight-period">{grouping==='days'?(from&&until?`${from} — ${until} · выручка каждого календарного дня`:'Выручка каждого календарного дня'):from&&until?(from===until?`За ${from} · один календарный день`:`${from} — ${until} · сумма за одинаковые часы всех дней периода`):'Сумма за одинаковые часы всех дней выбранного периода'}</p>
      {grouping==='days'&&(summary.days.length?<CashHourlyChart key="days" hours={summary.days} daily/>:<p className="cash-insight-empty">В выбранном периоде нет дневных операций.</p>)}
      {grouping==='hours'&&hours!==undefined&&hours.length>0&&<CashHourlyChart key="hours" hours={hours}/>}
      {grouping==='hours'&&(hours===undefined?<p className="cash-insight-empty">Нет данных о продажах по часам.</p>:
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
       </div>)}
      <p className="cash-insight-note">{grouping==='days'?'На графике — дни с кассовыми документами.':'На графике — все 24 часа; в списке — часы с кассовыми документами.'} Отрицательные значения означают превышение возвратов над продажами. Для выручки одного дня выберите дату в календаре.</p>
    </section>
    <section className="card cash-insight-section">
      <div className="cash-insight-heading"><div><span className="eyebrow">КАССА · АССОРТИМЕНТ</span><h3>{cohort==='app'?'Продажи по товарам · PIVNIK':'Продажи по товарам'}</h3></div>
        <small>Суммы после скидок · с учётом возвратов</small></div>
      {products===undefined?<p className="cash-insight-empty">Нет данных о товарных позициях.</p>:
       products.length===0?<p className="cash-insight-empty">В выбранном периоде нет товарных операций.</p>:
       <>
         <div className="cash-product-controls">
           <input aria-label="Поиск товара" type="search" placeholder="Поиск товара" value={query}
             onChange={e=>{setQuery(e.target.value);setLimit(10)}}/>
           <label>Сортировка
             <select aria-label="Сортировка товаров" value={sort} onChange={e=>changeSort(e.target.value,e.target.value==='name'?'asc':'desc')}>
               <option value="revenue">По выручке</option>
               <option value="quantity">По количеству</option>
               <option value="sales">По продажам</option>
               <option value="returns">По возвратам</option>
               <option value="name">По названию</option>
             </select>
           </label>
         </div>
         <div className="table-scroll">
           <table className="cash-product-table"><thead><tr>
             <SortTh label="Товар" column="name" sort={sort} direction={direction} onSort={changeSort} initialDirection="asc"/><SortTh label="Количество" column="quantity" sort={sort} direction={direction} onSort={changeSort}/><SortTh label="Продажи" column="sales" sort={sort} direction={direction} onSort={changeSort}/><SortTh label="Возвраты" column="returns" sort={sort} direction={direction} onSort={changeSort}/><SortTh label="Выручка" column="revenue" sort={sort} direction={direction} onSort={changeSort}/>
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
      <p className="cash-insight-note">{cohort==='app'?'Только чеки с подтверждённой связью PIVNIK. Отсутствие связанных товаров не доказывает отсутствия покупок через приложение. ':'Все кассовые документы выбранного заведения. '}Количество — проданное за вычетом возвращённого. Прибыль не рассчитывается: себестоимости в этих документах нет.</p>
    </section>
  </div>
}

export function CashDashboard({report,mode='all',loading=false,error='',comparison,comparisonSnapshot}:{report?:CashReport;mode?:'all'|'app';loading?:boolean;error?:string;comparison?:ReactNode;comparisonSnapshot?:CashComparisonSnapshot|null}){
  const readable=Boolean(report?.connection.lastSuccessAt)&&!['not_connected','schema_required'].includes(report?.connection.state||'')
  const all=readable?(mode==='app'?report?.app:report?.all):null
  const count=(n:number|null|undefined)=>n===null||n===undefined?'Нет данных':rub.format(n)
  const state=report?.connection.state
  const amountShare=all&&report?.app&&BigInt(all.salesCents)>0n?report.linkedRevenueSharePercent:null
  const receiptShare=all&&report?.app?linkedReceiptShare(report.app.receiptCount,all.receiptCount):null
  // POS summary already computes sales-before-returns / confirmed SELL receipts.
  // If receipt coverage is unknown or the cohort is empty, the average is not zero.
  const linkedAverage=report?.app?.receiptCount?report.app.averageCents:null
  const unlinkedAverage=report?.unlinked?.receiptCount?report.unlinked.averageCents:null
  const averageDifference=linkedAverage!=null&&unlinkedAverage!=null&&BigInt(unlinkedAverage)>0n
    ?cashPercentDelta(linkedAverage,unlinkedAverage):null
  // The app re-reads the whole cash history every couple of minutes; after one full pass a running
  // pass is routine, the totals are those of the last full pass.
  const refreshing=state==='syncing'&&Boolean(report?.connection.lastSuccessAt)
  const status=error?'Не удалось обновить кассу':loading?'Обновляем кассу':state==='error'?'Не удалось обновить кассу':state==='syncing'&&!refreshing?'Идёт первая загрузка кассы':state==='awaiting_sync'?'Ожидаем загрузку кассы':all?'Данные Эвотора':'Касса не подключена'
  // Comparison comes only from the opt-in request; never show a delta on stale or unverified data.
  const canCompare=(r:CashReport|undefined)=>Boolean(r?.connection.lastSuccessAt)&&!['not_connected','schema_required','error','awaiting_sync'].includes(r?.connection.state||'')
  const comparisonValid=!loading&&!error&&canCompare(report)&&canCompare(comparisonSnapshot?.report)
  const other=comparisonValid?(mode==='app'?comparisonSnapshot?.report.app:comparisonSnapshot?.report.all):null
  const trends=all&&other?[
    cashPercentDelta(all.netCents,other.netCents),
    cashPercentDelta(all.receiptCount,other.receiptCount),
    cashPercentDelta(report?.app?.activeBuyers,comparisonSnapshot?.report.app?.activeBuyers),
    cashPercentDelta(all.averageCents,other.averageCents),
  ]:[null,null,null,null]
  // A POS sale receipt is not a document operation. Unknown customer identity is never zero.
  const primaryKpis=[
    ['Выручка',cashMoney(all?.netCents),'Продажи за вычетом возвратов'],
    ['Чеков продажи',all?count(all.receiptCount):'Нет данных','Подтверждённые чеки продажи; при неполных данных количество неизвестно'],
    ['Клиентов PIVNIK',all?count(report?.app?.activeBuyers):'Нет данных','Только покупатели со связанными с приложением SELL; не все гости кассы'],
    ['Средний чек',cashMoney(all?.averageCents),'Сумма продаж / число подтверждённых чеков продажи'],
  ]
  const secondaryKpis=[
    ['Операций',all?count(all.saleDocuments+all.returnDocuments):'Нет данных','Документы продажи и возврата'],
  ]
  const tables=all?[
    {title:'Выручка по дням',label:'Дата',rows:all.days},
    {title:'Способы оплаты',label:'Оплата',rows:all.payments},
  ]:[]
  if(mode==='app'){
    const app=all as PosSummary|null|undefined
    secondaryKpis.push(['Повторных покупателей',count(app?.repeatBuyers),'Не менее двух связанных продаж в периоде'],
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
    <div className="kpi-grid cash-primary-kpis" aria-label="Основные показатели кассы">{primaryKpis.map(([label,value,source],index)=><CashKpi key={label} label={label} value={value} source={source} trend={trends[index]} trendPeriod={comparisonSnapshot?.periodLabel}/>)}</div>
    {mode==='all'&&all&&report?.app&&report.unlinked&&<section className="card cash-split cash-share" aria-label="Доля покупок клиентов PIVNIK">
      <div className="cash-share-heading"><div><span className="eyebrow">ЛОЯЛЬНОСТЬ · КАССА</span><h3>Внутри общей кассы</h3></div><small>Доля подтверждённо связанных покупок PIVNIK</small></div>
      <div className="cash-share-grid">
        <CashShareMetric label="По сумме продаж" percent={amountShare} note="Связанные продажи / все продажи, до возвратов"/>
        <CashShareMetric label="По количеству чеков" percent={receiptShare} note="Связанные чеки / все подтверждённые чеки продажи"/>
      </div>
      <section className="cash-cohort-averages" aria-label="Сравнение среднего чека">
        <h4>Средний чек по группам</h4>
        <div className="cash-cohort-average-grid">
          <div className="cash-cohort-average">
            <span>Покупки с подтверждённой связью PIVNIK</span>
            <strong>{cashMoney(linkedAverage)}</strong>
            <small>{report.app.receiptCount==null?'Количество чеков неизвестно':`Подтверждённых чеков: ${count(report.app.receiptCount)}`}</small>
          </div>
          <div className="cash-cohort-average">
            <span>Покупки без подтверждённой связи</span>
            <strong>{cashMoney(unlinkedAverage)}</strong>
            <small>{report.unlinked.receiptCount==null?'Количество чеков неизвестно':`Подтверждённых чеков: ${count(report.unlinked.receiptCount)}`}</small>
          </div>
        </div>
        <p>{averageDifference==null?'Для процентного сравнения нужны чеки обеих групп и ненулевой средний чек второй группы.':`Разница среднего чека связанной группы: ${averageDifference} относительно чеков без связи.`} Это сравнение групп, не доказательство влияния программы лояльности. Сумма продаж до возвратов / подтверждённые чеки SELL.</p>
      </section>
      <div className="cash-share-totals"><span>Клиенты PIVNIK: <b>{cashMoney(report.app.salesCents)}</b></span><span>Без связи с PIVNIK: <b>{cashMoney(report.unlinked.salesCents)}</b></span></div>
      <p className="cash-share-disclaimer">Чеки без подтверждённой связи включены в общую кассу. Нулевая доля связок не означает, что гости не использовали приложение. Суммы здесь до возвратов; клиентские покупки уже входят в общую сумму.</p>
    </section>}
    <p className="cash-insight-period">Изменение основных показателей появится в карточках после включения сравнения ниже. Дополнительный кассовый период загружается только по запросу.</p>
    {comparison}
    <details className="card cash-secondary-metrics">
      <summary>Другие показатели кассы</summary>
      <div className="kpi-grid cash-secondary-kpis">{secondaryKpis.map(([label,value,source])=><CashKpi key={label} label={label} value={value} source={source}/>)}</div>
    </details>
    {all&&<details className="card cash-calculation-details"><summary>Подробности расчёта</summary>
      <dl>
        <div><dt>Продажи до возвратов</dt><dd>{cashMoney(all.salesCents)}</dd></div>
        <div><dt>Возвраты</dt><dd>{cashMoney(all.returnsCents)} · {count(all.returnDocuments)} документов</dd></div>
        <div><dt>Документы продажи</dt><dd>{count(all.saleDocuments)}</dd></div>
        <div><dt>Подтверждённые чеки продажи</dt><dd>{count(all.receiptCount)}</dd></div>
      </dl>
      <p>Выручка = продажи − возвраты. Операции = документы продажи + документы возврата. Средний чек = продажи / подтверждённые чеки продажи.</p>
    </details>}
    {all&&<div className="two-cols">
      {tables.map(({title,label,rows})=><section className="card table-card" key={title}>
        <div className="table-section-title"><CardTitle title={title}/></div>
        <div className="table-scroll"><table><thead><tr><th>{label}</th><th>С учётом возвратов</th></tr></thead>
          <tbody>{rows.length?rows.map(row=><tr key={row.label}><td>{row.label}</td><td><strong>{cashMoney(row.amountCents)}</strong></td></tr>):<tr><td colSpan={2}>За период нет данных</td></tr>}</tbody></table></div>
      </section>)}
    </div>}
    {all&&<CashInsights key={mode} summary={all} period={report?.period} cohort={mode}/>} 
  </div>
}
