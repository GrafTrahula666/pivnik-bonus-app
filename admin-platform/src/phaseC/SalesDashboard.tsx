import { useEffect,useState } from 'react'
import { apiGet,ApiError,type ApiVenue } from '../api'
import { PageHead } from '../ui'
import { CashDashboard,type CashReport } from './CashDashboard'
import { isCashReport } from './cash-report'
import { ErrorCard,LoadingCard } from './common'

const moscowDay=(now=new Date())=>new Date(now.getTime()+3*3600000).toISOString().slice(0,10)
const presets=[[1,'Сегодня'],[7,'7 дней'],[14,'14 дней'],[30,'30 дней'],[90,'3 месяца'],[365,'Год']] as const

export function SalesDashboard({venue,days,mode}:{venue:ApiVenue;days:number;mode:'all'|'app'}){
  const [selection,setSelection]=useState('days:'+days)
  const today=moscowDay()
  const yesterday=moscowDay(new Date(Date.parse(today+'T00:00:00+03:00')-86400000))
  const date=selection==='yesterday'?yesterday:selection.startsWith('date:')?selection.slice(5):''
  const query=date?'date='+encodeURIComponent(date):'days='+selection.slice(5)
  const path=`/api/admin/venues/${venue.id}/pos?${query}`
  const chooseDate=(value:string)=>{
    if(/^\d{4}-\d{2}-\d{2}$/.test(value)&&value<=today&&
      moscowDay(new Date(value+'T00:00:00+03:00'))===value)setSelection('date:'+value)
  }
  return <div className="page">
    <div className="card cash-period-controls" role="group" aria-label="Период кассы">
      <div className="segmented cash-period-presets">
        <button type="button" className={selection==='days:1'?'active':''} aria-pressed={selection==='days:1'} onClick={()=>setSelection('days:1')}>Сегодня</button>
        <button type="button" className={selection==='yesterday'?'active':''} aria-pressed={selection==='yesterday'} onClick={()=>setSelection('yesterday')}>Вчера</button>
        {presets.slice(1).map(([n,label])=><button type="button" key={n} className={selection==='days:'+n?'active':''} aria-pressed={selection==='days:'+n} onClick={()=>setSelection('days:'+n)}>{label}</button>)}
      </div>
      <label className="cash-date-label">Любой день<input aria-label="Дата кассового отчёта" type="date" max={today} value={date} onChange={e=>chooseDate(e.target.value)}/></label>
      <small>Календарные дни · время Москвы</small>
    </div>
    <CashReportContent key={path} venue={venue} mode={mode} path={path}/>
  </div>
}

function CashReportContent({venue,mode,path}:{venue:ApiVenue;mode:'all'|'app';path:string}){
  const [report,setReport]=useState<CashReport>(),[error,setError]=useState(''),[loading,setLoading]=useState(true),[attempt,setAttempt]=useState(0)
  useEffect(()=>{
    let cancelled=false
    setLoading(true);setError('')
    apiGet<unknown>(path).then(value=>{
      if(!isCashReport(value))throw new Error('Некорректный ответ кассового API.')
      if(!cancelled)setReport(value)
    }).catch(e=>{
      if(cancelled)return
      if(e instanceof ApiError&&[401,403,404].includes(e.status))setReport(undefined)
      setError(e instanceof Error?e.message:'Не удалось обновить кассу')
    }).finally(()=>{if(!cancelled)setLoading(false)})
    return()=>{cancelled=true}
  },[path,attempt])
  return <div className="page">
    <PageHead eyebrow="ПРОДАЖИ · ЭВОТОР" title={mode==='all'?'Все продажи кассы':'Клиенты приложения'} sub={venue.name}
      actions={<button className="btn secondary" disabled={loading} onClick={()=>setAttempt(n=>n+1)}>Обновить</button>}/>
    {loading&&!report?<LoadingCard text="Загрузка кассовых документов…"/>:error&&!report?<ErrorCard error={error} onRetry={()=>setAttempt(n=>n+1)}/>:
      <CashDashboard report={report} mode={mode} loading={loading} error={error}/>}
  </div>
}
