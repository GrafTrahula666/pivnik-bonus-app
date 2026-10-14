import { useEffect,useState } from 'react'
import { apiGet } from '../api'
import { cashMoney } from './cash-format'
import { isCashReport,type CashReport } from './cash-report'

const day=(value:number)=>new Date(value+3*3600000).toISOString().slice(0,10)
const dateLabel=(value:string)=>new Date(value+'T00:00:00+03:00').toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow'})
const label=(from:string,to:string)=>from===to?dateLabel(from):dateLabel(from)+' — '+dateLabel(to)
const validDay=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00+03:00'))&&day(Date.parse(value+'T00:00:00+03:00'))===value
const metrics=[['revenue','Выручка'],['average','Средний чек'],['operations','Операции']] as const
type Metric=(typeof metrics)[number][0]
function readable(report:CashReport|undefined,mode:'all'|'app'){
  return report?.connection.lastSuccessAt&&!['not_connected','schema_required','error','awaiting_sync'].includes(report.connection.state)?(mode==='all'?report.all:report.app):null
}

export function CashComparison({venueId,report,mode,unavailable}:{venueId:string;report:CashReport;mode:'all'|'app';unavailable:boolean}){
  const [enabled,setEnabled]=useState(false),[custom,setCustom]=useState(false)
  const period=report.period!
  const start=Date.parse(period.from),end=Date.parse(period.until),duration=end-start
  const previous={from:day(start-duration),to:day(start-1)}
  const [draftFrom,setDraftFrom]=useState(previous.from),[draftTo,setDraftTo]=useState(previous.to)
  const [applied,setApplied]=useState(previous),[validation,setValidation]=useState('')
  const current={from:day(start),to:day(end-1)},second=custom?applied:previous
  const today=day(Date.now())
  const apply=()=>{
    const length=(Date.parse(draftTo+'T00:00:00+03:00')-Date.parse(draftFrom+'T00:00:00+03:00'))/86400000+1
    if(!validDay(draftFrom)||!validDay(draftTo)||draftTo>today||length<1||length>366){setValidation('Выберите от 1 до 366 дней, не позднее сегодняшнего.');return}
    setValidation('');setApplied({from:draftFrom,to:draftTo})
  }
  const path=`/api/admin/venues/${venueId}/pos?from=${second.from}&to=${second.to}`
  return <section className="card cash-comparison" aria-label="Сравнение кассовых периодов">
    <div className="cash-comparison-heading"><h3>Сравнение периодов</h3>
      <label><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>Сравнить</label></div>
    {enabled&&<>
      <div className="cash-comparison-controls"><label>С чем сравнить<select aria-label="Период для сравнения" value={custom?'custom':'previous'} onChange={e=>{setCustom(e.target.value==='custom');setValidation('')}}>
        <option value="previous">Предыдущий такой же период</option><option value="custom">Выбрать период в календаре</option>
      </select></label>
      {custom&&<div className="cash-comparison-dates">
        <label>С<input aria-label="Начало периода сравнения" type="date" max={today} value={draftFrom} onChange={e=>setDraftFrom(e.target.value)}/></label>
        <label>По<input aria-label="Конец периода сравнения" type="date" max={today} value={draftTo} onChange={e=>setDraftTo(e.target.value)}/></label>
        <button className="btn secondary" type="button" onClick={apply}>Применить</button>
      </div>}</div>
      {validation&&<p role="alert">{validation}</p>}
      {unavailable?<p className="cash-comparison-note">Обновите основной отчёт, чтобы сравнить актуальные данные.</p>:
        <ComparisonResult key={path} path={path} report={report} mode={mode} currentLabel={label(current.from,current.to)} secondLabel={label(second.from,second.to)}/>}
      <p className="cash-comparison-note">Границы дней — по Москве. {current.to===today?'Текущий период включает сегодня: день ещё не завершён. ':''}{(Date.parse(second.to)-Date.parse(second.from)+86400000)!==duration?'Периоды разной длительности: сравниваются суммы за каждый период, без пересчёта на день.':''}</p>
    </>}
  </section>
}

function ComparisonResult({path,report,mode,currentLabel,secondLabel}:{path:string;report:CashReport;mode:'all'|'app';currentLabel:string;secondLabel:string}){
  const [other,setOther]=useState<CashReport>(),[error,setError]=useState(''),[loading,setLoading]=useState(true),[attempt,setAttempt]=useState(0)
  const [metric,setMetric]=useState<Metric>('revenue')
  useEffect(()=>{
    let cancelled=false
    apiGet<unknown>(path).then(value=>{
      if(!isCashReport(value))throw new Error('Некорректный ответ кассового API.')
      if(!cancelled){setOther(value);setError('')}
    }).catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:'Не удалось загрузить сравнение')})
      .finally(()=>{if(!cancelled)setLoading(false)})
    return()=>{cancelled=true}
  },[path,attempt])
  if(loading)return <p className="cash-comparison-note">Загрузка периода сравнения…</p>
  if(error)return <div role="alert"><p>{error}</p><button className="btn secondary" onClick={()=>{setLoading(true);setAttempt(n=>n+1)}}>Повторить сравнение</button></div>
  const current=readable(report,mode),previous=readable(other,mode)
  const syncError=[report,other].some(item=>item?.connection.state==='error'&&Boolean(item.connection.lastSuccessAt))
  const value=(summary:typeof current)=>!summary?null:metric==='revenue'?BigInt(summary.netCents):metric==='average'?(summary.averageCents===null?null:BigInt(summary.averageCents)):BigInt(summary.saleDocuments)+BigInt(summary.returnDocuments)
  const a=value(current),b=value(previous)
  const money=metric!=='operations',format=(n:bigint)=>money?cashMoney(String(n)):n.toLocaleString('ru-RU')
  const known=[a,b].filter((n):n is bigint=>n!==null)
  const minimum=known.reduce((min,n)=>n<min?n:min,0n),maximum=known.reduce((max,n)=>n>max?n:max,0n)
  const span=maximum-minimum||1n
  const percent=(n:bigint)=>Number((n-minimum)*10000n/span)/100
  const change=a!==null&&b!==null?a-b:null
  const absolute=(n:bigint)=>n<0n?-n:n
  const scaled=change!==null&&b!==null&&b!==0n?absolute(change)*10000n/absolute(b):0n
  const percentLabel=(scaled/100n).toLocaleString('ru-RU')+(scaled%100n?','+String(scaled%100n).padStart(2,'0'):'')
  const deltaPercent=change===null||b===null?null:b===0n?(change===0n?'0%':'Нет базы для %'):
    (change>0n?'+':change<0n?'−':'')+percentLabel+'%'
  return <>
    <div className="segmented cash-comparison-metrics" role="group" aria-label="Показатель сравнения">{metrics.map(([id,title])=><button key={id} type="button" aria-pressed={metric===id} className={metric===id?'active':''} onClick={()=>setMetric(id)}>{title}</button>)}</div>
    <div className="cash-comparison-chart" role="img" aria-label={`${metrics.find(([id])=>id===metric)?.[1]}: ${currentLabel} — ${a===null?'Нет данных':format(a)}; ${secondLabel} — ${b===null?'Нет данных':format(b)}`}>
      {[{amount:a,title:currentLabel,kind:'current'},{amount:b,title:secondLabel,kind:'previous'}].map(({amount,title,kind})=>{
        return <div className="cash-comparison-row" key={String(kind)}><div><span>{String(title)}</span><b>{amount===null?'Нет данных':format(amount)}</b></div>
          <div className="cash-comparison-track"><i style={{left:percent(0n)+'%'}}/>{amount!==null&&<span className={'cash-comparison-bar '+kind+(amount<0n?' negative':'')} style={{left:percent(amount<0n?amount:0n)+'%',width:Math.abs(percent(amount)-percent(0n))+'%'}}/>}</div>
        </div>
      })}
    </div>
    <p className="cash-comparison-delta">{change===null?(syncError?'Сравнение недоступно: ошибка синхронизации кассы. Данные последней успешной сверки сохранены, но сравнение заблокировано.':'Сравнение недоступно: недостаточно данных.'):<>Изменение: <b>{change>0n?'+':''}{format(change)}</b> · {deltaPercent}</>}</p>
  </>
}
