import { CircleHelp,Database } from 'lucide-react'
import { CardTitle,cn,rub } from '../ui'

// Optional, venue-scoped server payload from the Evotor POS service.
// The loyalty ledger must never substitute for a missing cash-register report.
export interface CashReport {
  connection:{state:string;lastSuccessAt?:string|null;errorCode?:string|null}
  all:null|{
    salesCents:string;returnsCents:string;netCents:string;averageCents:string|null
    receiptCount:number|null;saleDocuments:number;returnDocuments:number
    days:Array<{label:string;amountCents:string}>
    payments:Array<{label:string;amountCents:string}>
  }
}

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

export function CashDashboard({report}:{report?:CashReport}){
  const readable=Boolean(report?.connection.lastSuccessAt)&&!['not_connected','schema_required'].includes(report?.connection.state||'')
  const all=readable?report?.all:null
  const count=(n:number|null|undefined)=>n===null||n===undefined?'Нет данных':rub.format(n)
  const state=report?.connection.state
  const status=state==='error'?'Не удалось обновить кассу':state==='syncing'?'Идёт сверка кассы':state==='awaiting_sync'?'Ожидаем загрузку кассы':all?'Данные Эвотора':'Касса не подключена'
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
  return <div className="page cash-dashboard">
    <section className="card data-quality-card" aria-live="polite"><div><Database/><div><b>{status}</b><span>{all?'Все покупки, включая гостей без приложения. Покупателей по чекам не определяем.':'Кассовые показатели появятся после подключения Эвотора и полной загрузки. Данные программы лояльности здесь не используются.'}</span></div></div>
      {report?.connection.lastSuccessAt&&<p className="comparison-note">Последняя полная сверка: {new Date(report.connection.lastSuccessAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})}. Время — по Москве.</p>}
    </section>
    <div className="kpi-grid">{kpis.map(([label,value,source])=><CashKpi key={label} label={label} value={value} source={source}/>)}</div>
    {all&&<div className="two-cols">
      {tables.map(({title,label,rows})=><section className="card table-card" key={title}>
        <div className="table-section-title"><CardTitle title={title}/></div>
        <div className="table-scroll"><table><thead><tr><th>{label}</th><th>С учётом возвратов</th></tr></thead>
          <tbody>{rows.length?rows.map(row=><tr key={row.label}><td>{row.label}</td><td><strong>{cashMoney(row.amountCents)}</strong></td></tr>):<tr><td colSpan={2}>За период нет данных</td></tr>}</tbody></table></div>
      </section>)}
    </div>}
  </div>
}
