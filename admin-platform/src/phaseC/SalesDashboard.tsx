import { useEffect,useState } from 'react'
import { apiGet,ApiError,type ApiVenue } from '../api'
import { PageHead } from '../ui'
import { CashDashboard,type CashReport } from './CashDashboard'
import { isCashReport } from './cash-report'
import { ErrorCard,LoadingCard } from './common'

export function SalesDashboard({venue,days,mode}:{venue:ApiVenue;days:number;mode:'all'|'app'}){
  const [report,setReport]=useState<CashReport>(),[error,setError]=useState(''),[loading,setLoading]=useState(true),[attempt,setAttempt]=useState(0)
  const path=`/api/admin/venues/${venue.id}/pos?days=${days}`
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
