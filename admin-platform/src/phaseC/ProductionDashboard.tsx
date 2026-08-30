import { useMemo,useState } from 'react'
import { BarChart3,CircleHelp,Database,ShieldCheck,TrendingDown,TrendingUp } from 'lucide-react'
import { Area,AreaChart,CartesianGrid,ResponsiveContainer,Tooltip,XAxis,YAxis } from 'recharts'
import type { Page } from '../appTypes'
import type { ApiVenue } from '../api'
import type { Period } from './Layout'
import { PageHead,cn,pct,rub } from '../ui'
import { ErrorCard,LivePill,LoadingCard,SourceNote,useResource } from './common'

type Metric={value:number|null;available:boolean;reason?:string;source?:string}
interface Dashboard {
  metrics:Record<string,Metric>
  previousMetrics:Record<string,number|null>
  trend:Array<{day:string;revenue:number;checks:number;customers:number;bonusEarned:number;bonusRedeemed:number}>
  platformSplit:{vk:number;telegram:number;both:number;unknown:number;note:string}
  unavailableMetrics:Array<{key:string;reason:string;requiredEvent:string}>
  dataSource:{legacyBarId:string|null;accountMode:string}
}
const days=(p:Period)=>p==='Сегодня'?1:p==='7 дней'?7:p==='30 дней'?30:p==='3 месяца'?90:365
const format=(m:Metric,kind:'money'|'number'|'percent')=>{
  if(!m?.available||m.value===null)return 'Нет данных'
  if(kind==='money')return `₽ ${rub.format(Math.round(m.value))}`
  if(kind==='percent')return `${pct.format(m.value)}%`
  return rub.format(Math.round(m.value))
}
function delta(current:number|null,previous:number|null|undefined){
  if(current===null||previous===null||previous===undefined||previous===0)return null
  return (current-previous)/Math.abs(previous)*100
}
function LiveKpi({label,metric,kind,previous}:{label:string;metric:Metric;kind:'money'|'number'|'percent';previous?:number|null}){
  const change=metric.available?delta(metric.value,previous):null
  return <div className={cn('kpi card live-kpi',!metric.available&&'kpi-unavailable')}>
    <div className="kpi-top"><span>{label}</span><span className="ghost-icon info-icon" role="img" aria-label="Источник метрики" title={metric.source||metric.reason||''}><CircleHelp size={14}/></span></div>
    <div className="kpi-value">{format(metric,kind)}</div>
    {metric.available?<div className={cn('delta',change!==null&&change<0&&'negative')}>
      {change===null?null:change<0?<TrendingDown/>:<TrendingUp/>}{change===null?'сравнение недоступно':`${pct.format(Math.abs(change))}%`}<span>к периоду</span>
    </div>:<div className="kpi-reason">{metric.reason||'Пока недостаточно данных'}</div>}
  </div>
}
export function ProductionDashboard({venue,period,compare,onNavigate}:{venue:ApiVenue;period:Period;compare:boolean;onNavigate:(p:Page)=>void}){
  const path=`/api/admin/venues/${venue.id}/dashboard?days=${days(period)}`
  const {data,error,loading,reload}=useResource<Dashboard>(path)
  const [metric,setMetric]=useState<'revenue'|'customers'|'bonuses'|'visits'>('revenue')
  const chart=useMemo(()=>data?.trend.map(x=>({day:x.day.slice(5),revenue:x.revenue,customers:x.customers,bonuses:x.bonusEarned-x.bonusRedeemed}))||[],[data])
  if(loading&&!data)return <><PageHead eyebrow="ПОКАЗАТЕЛИ ЗАВЕДЕНИЯ" title={venue.name} sub="Загрузка данных"/><LoadingCard/></>
  if(error&&!data)return <ErrorCard error={error} onRetry={reload}/>
  if(!data)return null
  const m=data.metrics,p=data.previousMetrics
  const kpis=[
    ['Выручка',m.trackedRevenue,'money',p.trackedRevenue],
    ['Чеков',m.checkCount,'number',p.checkCount],
    ['Средний чек',m.averageCheck,'money',p.averageCheck],
    ['Клиентов всего',m.totalCustomers,'number',p.totalCustomers],
    ['Новых клиентов',m.newCustomers,'number',p.newCustomers],
    ['Активных по операциям',m.activeCustomers,'number',p.transactionActiveCustomers],
    ['Повторных клиентов',m.returningCustomers,'number',p.returningCustomers],
    ['Начислено бонусов',m.bonusEarned,'number',p.bonusEarned],
    ['Списано бонусов',m.bonusRedeemed,'number',p.bonusRedeemed],
    ['Баланс бонусов',m.outstandingBonusBalance,'number',p.outstandingBonusBalance],
    ['Посещений',m.visits,'number',null],
    ['Доля списаний',m.redemptionRate,'percent',p.redemptionRate],
  ] as const
  return <div className="page">
    <PageHead eyebrow="ПОКАЗАТЕЛИ ЗАВЕДЕНИЯ" title={venue.name}
      sub={`${period} · ${venue.companyName}`}
      actions={<LivePill/>}/>
    <div className="kpi-grid">{kpis.map(([label,mm,kind,prev])=><LiveKpi key={label} label={label} metric={mm as Metric} kind={kind} previous={prev as number|null|undefined}/>)}</div>
    <div className="grid-main">
      <section className="card chart-card">
        <div className="card-head"><div><span className="eyebrow">ДИНАМИКА</span><h3>{format(m.trackedRevenue,'money')}</h3></div>
          <div className="segmented">{[['revenue','Выручка'],['customers','Клиенты'],['bonuses','Бонусы'],['visits','Посещения']].map(([id,label])=>
            <button key={id} className={metric===id?'active':''} onClick={()=>setMetric(id as typeof metric)}>{label}</button>)}</div>
        </div>
        <div className="chart">
          {metric==='visits'?<div className="chart-empty"><CircleHelp/><b>Пока недостаточно данных</b><span>Показатель появится после накопления истории посещений.</span></div>:
          chart.length?<ResponsiveContainer width="100%" height="100%"><AreaChart data={chart}>
            <defs><linearGradient id="liveFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#b9ff66" stopOpacity=".25"/><stop offset="1" stopColor="#b9ff66" stopOpacity="0"/></linearGradient></defs>
            <CartesianGrid vertical={false} stroke="#22262b" strokeDasharray="4 4"/><XAxis dataKey="day" tick={{fill:'#777e88',fontSize:11}} axisLine={false} tickLine={false} interval="preserveStartEnd"/>
            <YAxis tick={{fill:'#777e88',fontSize:11}} axisLine={false} tickLine={false}/><Tooltip/><Area type="monotone" dataKey={metric} stroke="#b9ff66" fill="url(#liveFill)" strokeWidth={2}/>
          </AreaChart></ResponsiveContainer>:<div className="chart-empty"><Database/><b>За период нет операций</b></div>}
        </div>
        {compare&&<div className="chart-legend"><span className="legend-now"/>Текущий период <span className="comparison-note">KPI сравниваются с предыдущим периодом</span></div>}
      </section>
      <section className="card quick-card">
        <div className="card-head"><div><span className="eyebrow">УПРАВЛЕНИЕ</span><h3>Центр настроек</h3></div><ShieldCheck/></div>
        {[
          ['Лояльность','Уровни и кэшбэк','loyalty'],['Колесо','Призы и вероятности','wheel'],['Достижения','Условия и награды','achievements'],
          ['Магазин','Каталог и остатки','shop'],['Акции','Расписание и статусы','promotions'],['Оформление','Стиль приложения','brand'],
        ].map(([label,value,page])=><button className="quick-row" key={label} onClick={()=>onNavigate(page as Page)}><span>{label}</span><b>{value}</b><TrendingUp size={15}/></button>)}
        <SourceNote>Изменения настроек безопасно отделены от работы приложений для гостей.</SourceNote>
      </section>
    </div>
    <div className="analytics-grid">
      <div className="card mini-insight"><div><span>Клиенты VK</span><b>{rub.format(data.platformSplit.vk)}</b><small>подключённые профили</small></div><div className="mini-viz"><BarChart3/></div></div>
      <div className="card mini-insight"><div><span>Клиенты Telegram</span><b>{rub.format(data.platformSplit.telegram)}</b><small>подключённые профили</small></div><div className="mini-viz"><BarChart3/></div></div>
      <div className="card mini-insight"><div><span>Активная аудитория</span><b>Нет данных</b><small>история ещё накапливается</small></div></div>
      <div className="card mini-insight"><div><span>Возвращаемость</span><b>Нет данных</b><small>история ещё накапливается</small></div></div>
    </div>
    <section className="card data-quality-card"><div><Database/><div><b>Честная аналитика</b><span>Показатели отображаются только при наличии достоверных данных.</span></div></div>
      <div className="data-quality-list">{data.unavailableMetrics.map(x=><div key={x.key}><span>{x.key}</span><b>Пока недостаточно данных</b><small>История показателя ещё накапливается</small></div>)}</div>
    </section>
  </div>
}
