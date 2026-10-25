import { useMemo,useState } from 'react'
import { BarChart3,CircleHelp,Database,ShieldCheck,TrendingDown,TrendingUp } from 'lucide-react'
import { Area,AreaChart,CartesianGrid,ResponsiveContainer,Tooltip,XAxis,YAxis } from 'recharts'
import type { Page } from '../appTypes'
import type { ApiVenue } from '../api'
import type { Period } from './Layout'
import { PageHead,cn,pct,rub } from '../ui'
import { ErrorCard,LoadingCard,SourceNote,useResource } from './common'
import { SalesDashboard } from './SalesDashboard'
import { validateCashRange } from './cash-period'
import './cash-panel.css'

type Metric={value:number|null;available:boolean;reason?:string;source?:string}
interface Dashboard {
  period:{from:string;to:string;days:number}
  metrics:Record<string,Metric>
  hourly?:Array<{hour:number;revenue:number;checks:number;operations:number;customers:number;bonusEarned:number;bonusRedeemed:number}>
  previousMetrics:Record<string,number|null>
  trend:Array<{day:string;revenue:number;checks:number;customers:number;bonusEarned:number;bonusRedeemed:number;operations?:number}>
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

const moscowDay = (value = new Date()) => new Date(value.getTime() + 3 * 3_600_000).toISOString().slice(0,10)

function ApplicationOperationsDashboard({venue,period,compare,onNavigate,spaceverse=false}:{venue:ApiVenue;period:Period;compare:boolean;onNavigate:(p:Page)=>void;spaceverse?:boolean}){
  const [selection,setSelection]=useState('days:'+days(period))
  const [from,setFrom]=useState(''),[to,setTo]=useState(''),[validation,setValidation]=useState('')
  const [grouping,setGrouping]=useState<'hours'|'days'>('days')
  const [showComparison,setShowComparison]=useState(compare)
  const [metric,setMetric]=useState<'revenue'|'operations'|'customers'|'bonuses'|'visits'>('revenue')
  const today=moscowDay()
  const yesterday=moscowDay(new Date(Date.parse(today+'T00:00:00+03:00')-86_400_000))
  const date=selection==='yesterday'?yesterday:selection.startsWith('date:')?selection.slice(5):''
  const query=selection.startsWith('range:')?
    'from='+encodeURIComponent(selection.split(':')[1]||'')+'&to='+encodeURIComponent(selection.split(':')[2]||''):
    date?'date='+encodeURIComponent(date):'days='+encodeURIComponent(selection.slice(5))
  const path='/api/admin/venues/'+venue.id+'/dashboard?'+query
  const {data,error,loading,reload}=useResource<Dashboard>(path)
  const presets=[[1,'Сегодня'],[7,'7 дней'],[14,'14 дней'],[30,'30 дней'],[90,'3 месяца'],[365,'Год']] as const
  const updatePeriod=(value:string)=>{setSelection(value);setValidation('');setGrouping(value==='yesterday'||value.startsWith('date:')?'hours':'days')}
  const chart=useMemo(()=>{
    if(!data)return []
    if(grouping==='hours'){
      if(!data.hourly)return []
      const source=new Map(data.hourly.map(row=>[row.hour,row]))
      return Array.from({length:24},(_,hour)=>{
        const row=source.get(hour)
        return {label:String(hour).padStart(2,'0')+':00',revenue:row?.revenue||0,operations:row?.operations||0,customers:row?.customers||0,bonuses:(row?.bonusEarned||0)-(row?.bonusRedeemed||0)}
      })
    }
    const source=new Map(data.trend.map(row=>[row.day,row]))
    const start=Date.parse(data.period.from)
    return Array.from({length:Math.min(366,data.period.days)},(_,index)=>{
      const day=new Date(start+index*86_400_000+3*3_600_000).toISOString().slice(0,10)
      const row=source.get(day)
      return {label:day.slice(5),revenue:row?.revenue||0,operations:row?.operations||0,customers:row?.customers||0,bonuses:(row?.bonusEarned||0)-(row?.bonusRedeemed||0)}
    })
  },[data,grouping])
  const controls=<div className="card cash-period-controls" role="group" aria-label="Период операций приложения">
    <div className="segmented cash-period-presets">
      <button type="button" className={selection==='days:1'?'active':''} aria-pressed={selection==='days:1'} onClick={()=>updatePeriod('days:1')}>Сегодня</button>
      <button type="button" className={selection==='yesterday'?'active':''} aria-pressed={selection==='yesterday'} onClick={()=>updatePeriod('yesterday')}>Вчера</button>
      {presets.slice(1).map(([count,label])=><button type="button" key={count} className={selection==='days:'+count?'active':''} aria-pressed={selection==='days:'+count} onClick={()=>updatePeriod('days:'+count)}>{label}</button>)}
    </div>
    <label className="cash-date-label">Любой день<input type="date" aria-label="Дата операций приложения" max={today} value={date} onChange={event=>{
      const chosen=event.target.value
      const problem=validateCashRange(chosen,chosen,today)
      setValidation(problem)
      if(!problem)updatePeriod('date:'+chosen)
    }}/></label>
    <form aria-label="Произвольный период операций приложения" onSubmit={event=>{
      event.preventDefault()
      const problem=validateCashRange(from,to,today)
      setValidation(problem)
      if(!problem)updatePeriod('range:'+from+':'+to)
    }}>
      <label>С даты<input type="date" name="from" aria-label="Начало периода операций" max={today} required value={from} onChange={event=>setFrom(event.target.value)}/></label>
      <label>По дату включительно<input type="date" name="to" aria-label="Конец периода операций" max={today} required value={to} onChange={event=>setTo(event.target.value)}/></label>
      <button className="btn secondary" type="submit">Показать период</button>
      {validation&&<p className="cash-period-error" role="alert">{validation}</p>}
    </form>
    <small>Календарные дни · время Москвы · максимум 366 дней</small>
  </div>
  if(loading)return <div className="page">{controls}<LoadingCard text="Загрузка операций за выбранный период…"/></div>
  if(error)return <div className="page">{controls}<ErrorCard error={error} onRetry={reload}/></div>
  if(!data)return <div className="page">{controls}<ErrorCard error="Нет данных по операциям."/></div>
  const startLabel=new Date(data.period.from).toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow'})
  const endLabel=new Date(Date.parse(data.period.to)-1).toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow'})
  const periodLabel=startLabel===endLabel?startLabel:startLabel+' — '+endLabel
  const m=data.metrics,p=data.previousMetrics
  const kpis=[
    ['Сумма операций приложения',m.trackedRevenue,'money',p.trackedRevenue],
    ['Записей о покупках',m.checkCount,'number',p.checkCount],
    ['Средняя сумма записи',m.averageCheck,'money',p.averageCheck],
    ['Клиентов всего',m.totalCustomers,'number',p.totalCustomers],
    ['Новых клиентов',m.newCustomers,'number',p.newCustomers],
    ['Совершали операции',m.activeCustomers,'number',p.transactionActiveCustomers],
    ['Повторных клиентов',m.returningCustomers,'number',p.returningCustomers],
    ['Начислено по программе',m.bonusEarned,'number',p.bonusEarned],
    ['Списано клиентами',m.bonusRedeemed,'number',p.bonusRedeemed],
    ['Бонусы в обращении',m.outstandingBonusBalance,'number',p.outstandingBonusBalance],
    ['Посещений',m.visits,'number',null],
    ['Использование бонусов',m.redemptionRate,'percent',p.redemptionRate],
  ] as const
  return <div className="page">
    {controls}
    <PageHead eyebrow="ПОКАЗАТЕЛИ ЗАВЕДЕНИЯ" title={venue.name}
      sub={periodLabel+' · '+venue.companyName}
      actions={<button className="btn secondary" onClick={reload}>Обновить</button>}/>
    <SourceNote>Операции приложения. Не являются подтверждённой кассовой выручкой и не складываются с Эвотором.</SourceNote>
    <div className="kpi-grid">{kpis.map(([label,mm,kind,prev])=><LiveKpi key={label} label={label} metric={mm as Metric} kind={kind} previous={prev as number|null|undefined}/>)}</div>
    <SourceNote>Ручные персональные подарки не входят в бизнес-KPI обзора. Клиентов всего и бонусы в обращении показывают текущее состояние, а не значение на историческую дату.</SourceNote>
    <div className="grid-main">
      <section className="card chart-card">
        <div className="card-head"><div><span className="eyebrow">ДИНАМИКА</span><h3>Операции за {periodLabel}</h3></div>
          <div className="segmented">{[['revenue','Суммы журнала'],['operations','Операции'],['customers','Клиенты'],['bonuses','Бонусы'],['visits','Посещения']].map(([id,label])=>
            <button type="button" aria-pressed={metric===id} key={id} className={metric===id?'active':''} onClick={()=>setMetric(id as typeof metric)}>{label}</button>)}</div>
        </div>
        <div className="segmented cash-chart-grouping" role="group" aria-label="Группировка операций">
          <button type="button" aria-pressed={grouping==='hours'} className={grouping==='hours'?'active':''} onClick={()=>setGrouping('hours')}>По часам</button>
          <button type="button" aria-pressed={grouping==='days'} className={grouping==='days'?'active':''} onClick={()=>setGrouping('days')}>По дням</button>
        </div>
        <p className="cash-insight-period">{grouping==='hours'?'Сумма по одинаковым часам выбранных дней':'Динамика по календарным дням'} · МСК. Дни и часы без операций показаны нулём.</p>
        <div className="chart">
          {metric==='visits'?<div className="chart-empty"><CircleHelp/><b>Пока недостаточно данных</b><span>Показатель появится после накопления истории посещений.</span></div>:
          chart.length?<ResponsiveContainer width="100%" height="100%"><AreaChart key={metric+grouping+path} data={chart}>
            <defs><linearGradient id="liveFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".25"/><stop offset="1" stopColor="var(--accent)" stopOpacity="0"/></linearGradient></defs>
            <CartesianGrid vertical={false} stroke="#173336" strokeDasharray="4 4"/><XAxis dataKey="label" tick={{fill:'#6e8d91',fontSize:11}} axisLine={false} tickLine={false} interval="preserveStartEnd"/>
            <YAxis tick={{fill:'#6e8d91',fontSize:11}} axisLine={false} tickLine={false}/><Tooltip/><Area type="monotone" dataKey={metric} stroke="var(--accent)" fill="url(#liveFill)" strokeWidth={2} isAnimationActive animationDuration={800} animationEasing="ease-out"/>
          </AreaChart></ResponsiveContainer>:<div className="chart-empty"><Database/><b>{grouping==='hours'?'Нет данных о часах':'За период нет операций'}</b></div>}
        </div>
        <div className="chart-legend"><span className="legend-now"/>По журналу приложения <span className="comparison-note">День и час определяются по Москве. Клиенты уникальны внутри каждой точки графика.</span></div>
      </section>
      <section className="card quick-card">
        <div className="card-head"><div><span className="eyebrow">УПРАВЛЕНИЕ</span><h3>Центр настроек</h3></div><ShieldCheck/></div>
        {[
          ['Лояльность','Уровни и кэшбэк','loyalty'],['Колесо','Призы и вероятности','wheel'],['Достижения','Условия и награды','achievements'],
          ['Магазин','Каталог и остатки','shop'],['Акции','Расписание и статусы','promotions'],['Оформление','Стиль приложения','brand'],
        ].filter(([, ,page])=>!spaceverse||!['wheel','achievements'].includes(page!)).map(([label,value,page])=><button className="quick-row" key={label} onClick={()=>onNavigate(page as Page)}><span>{label}</span><b>{value}</b><TrendingUp size={15}/></button>)}
        <SourceNote>Изменения настроек безопасно отделены от работы приложений для гостей.</SourceNote>
      </section>
    </div>
    <section className="card cash-comparison">
      <div className="cash-comparison-heading"><h3>Сравнение с предыдущим периодом</h3>
        <label><input aria-label="Сравнить операции с предыдущим периодом" type="checkbox" checked={showComparison} onChange={event=>setShowComparison(event.target.checked)}/>Сравнить</label>
      </div>
      {showComparison&&<div className="cash-comparison-chart" role="group" aria-label="Сравнение сумм и операций приложения">
        {([
          ['Сумма записей, ₽',m.trackedRevenue.value,data.previousMetrics.trackedRevenue],
          ['Средняя сумма записи, ₽',m.averageCheck.value,data.previousMetrics.averageCheck],
          ['Всего операций',m.operationCount.value,data.previousMetrics.operationCount],
        ] as Array<[string,number|null,number|null]>).map(([label,current,previous])=>{
          const high=Math.max(0,current||0,previous||0)
          return <div className="cash-comparison-row" key={label}>
            <div><span>{label}</span><b>{current===null?'Нет данных':rub.format(Math.round(current))} / {previous===null?'Нет данных':rub.format(Math.round(previous))}</b></div>
            <div className="cash-comparison-track">
              {high>0&&current!==null&&<div className="cash-comparison-bar" style={{width:(current/high*100)+'%'}}/>}
              {high>0&&previous!==null&&<div className="cash-comparison-bar previous" style={{width:(previous/high*100)+'%',top:'13px'}}/>}
            </div>
          </div>
        })}
      </div>}
      <p className="cash-comparison-note">Слева текущий период, справа предыдущий такой же длительности. Сравниваются только записи приложения, не фискальная выручка Эвотора.</p>
    </section>
    <div className="analytics-grid">
      <div className="card mini-insight"><div><span>Клиенты VK</span><b>{rub.format(data.platformSplit.vk)}</b><small>подключённые профили</small></div><div className="mini-viz"><BarChart3/></div></div>
      <div className="card mini-insight"><div><span>Клиенты Telegram</span><b>{rub.format(data.platformSplit.telegram)}</b><small>подключённые профили</small></div><div className="mini-viz"><BarChart3/></div></div>
      <div className="card mini-insight"><div><span>Активная аудитория</span><b>Нет данных</b><small>история ещё накапливается</small></div></div>
      <div className="card mini-insight"><div><span>Возвращаемость</span><b>Нет данных</b><small>история ещё накапливается</small></div></div>
    </div>
    <section className="card data-quality-card"><div><Database/><div><b>Качество данных</b><span>Панель показывает только те показатели, которые можно корректно посчитать по текущей истории.</span></div></div>
      <div className="data-quality-list">{data.unavailableMetrics.map(x=><div key={x.key}><span>{x.key}</span><b>Пока недостаточно данных</b><small>История показателя ещё накапливается</small></div>)}</div>
    </section>
  </div>
}

export function ProductionDashboard(props:{venue:ApiVenue;period:Period;compare:boolean;onNavigate:(p:Page)=>void;spaceverse?:boolean}){
  const [source,setSource]=useState<'all'|'app'|'operations'>('all')
  return <div className="page">
    <div className="segmented dashboard-sources" role="group" aria-label="Продажи">
      <button className={source==='all'?'active':''} aria-pressed={source==='all'} onClick={()=>setSource('all')}>Все продажи кассы</button>
      <button className={source==='app'?'active':''} aria-pressed={source==='app'} onClick={()=>setSource('app')}>Клиенты приложения</button>
      <button className={source==='operations'?'active':''} aria-pressed={source==='operations'} onClick={()=>setSource('operations')}>Операции приложения</button>
    </div>
    {source==='operations'?<ApplicationOperationsDashboard key={props.venue.id} {...props}/>:
      <SalesDashboard key={props.venue.id+':'+props.period} venue={props.venue} days={days(props.period)} mode={source}/>}
  </div>
}
