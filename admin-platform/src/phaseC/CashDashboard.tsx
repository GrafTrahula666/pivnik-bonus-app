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
  </div>
}
