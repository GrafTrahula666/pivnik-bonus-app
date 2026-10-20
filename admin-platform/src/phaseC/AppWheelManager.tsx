import { useEffect,useState } from 'react'
import { AlertTriangle,Gift,Save } from 'lucide-react'
import type { AdminSession,ApiVenue } from '../api'
import { apiPut } from '../api'
import { ConfirmModal,PageHead } from '../ui'
import { ErrorCard,LoadingCard,SourceNote,WriteGatePill,dt,num,useResource } from './common'
import { LinkedToAppNote } from './AppContentManagers'
import { PivnikLegacyWheelManager } from './PivnikLegacyManagers'

// Wheel of the PIVNIK app: chances of the regular prizes, paid spin prices and the free spin interval.
// Prize amounts stay as the approved wheel artwork pictures them; the jackpot stays 1 in 1,000,000.

interface Prize {code:string;title:string;bonus:number;beerMl:number;annualSupply:boolean;chancePercent:number}
interface Settings {chances:Record<string,number>;firstPaidCost:number;nextPaidCost:number;freeIntervalHours:number}
interface AppWheel {
  settings:Settings;prizes:Prize[];updatedAt:string|null;updatedBy:string|null;writesEnabled:boolean
  last30Days:{spins:number;paidSpins:number;bonusSpent:number;bonusAwarded:number;beerAwardedMl:number;guests:number}
}
type WheelResponse=(AppWheel&{configured:true})|{configured:false}
interface Draft {chances:Record<string,string>;firstPaidCost:string;nextPaidCost:string;freeIntervalHours:string}

const toDraft=(s:Settings):Draft=>({chances:Object.fromEntries(Object.entries(s.chances).map(([code,value])=>[code,String(value)])),
  firstPaidCost:String(s.firstPaidCost),nextPaidCost:String(s.nextPaidCost),freeIntervalHours:String(s.freeIntervalHours)})
const hundredths=(value:string)=>Math.round(Number(value)*100)
const percent=(value:number)=>`${value.toLocaleString('ru-RU',{maximumFractionDigits:4})}%`
function reward(prize:Prize){
  if(prize.annualSupply)return 'Бокал в день, 365 дней'
  if(prize.beerMl)return `${(prize.beerMl/1000).toLocaleString('ru-RU')} л пива`
  return `+${num(prize.bonus)} бонусов`
}
function problem(draft:Draft):string{
  for(const [code,value] of Object.entries(draft.chances)){
    const n=Number(value)
    if(value.trim()===''||!Number.isFinite(n)||n<0||n>100||Math.abs(hundredths(value)-n*100)>1e-6)return `Шанс «${code}»: от 0 до 100, не больше двух знаков после запятой.`
  }
  const total=Object.values(draft.chances).reduce((sum,value)=>sum+hundredths(value),0)
  if(total!==10_000)return `Сумма шансов должна быть ровно 100%, сейчас ${percent(total/100)}.`
  if(!(Number(draft.chances['beer-glass'])>0))return 'У бокала пива шанс должен быть больше 0%: из его доли берётся билет главного приза.'
  for(const [label,value] of [['Первое платное вращение',draft.firstPaidCost],['Следующие платные вращения',draft.nextPaidCost]] as const){
    const n=Number(value);if(!Number.isInteger(n)||n<1||n>10000)return `${label}: от 1 до 10 000 бонусов.`
  }
  const hours=Number(draft.freeIntervalHours)
  if(!Number.isInteger(hours)||hours<1||hours>168)return 'Бесплатное вращение: раз в 1–168 часов.'
  return ''
}

export function AppWheelManager({venue,session}:{venue:ApiVenue;session:AdminSession}){
  const {data,error,loading,reload,setData}=useResource<WheelResponse>(`/api/admin/venues/${venue.id}/app/wheel`)
  if(loading&&!data)return <LoadingCard/>
  if(error&&!data)return <ErrorCard error={error} onRetry={reload}/>
  if(!data)return null
  if(!data.configured)return <PivnikLegacyWheelManager venue={venue}/>
  return <LinkedWheel venue={venue} session={session} data={data} onSaved={saved=>setData({...saved,configured:true,writesEnabled:data.writesEnabled})}/>
}

function LinkedWheel({venue,session,data,onSaved}:{venue:ApiVenue;session:AdminSession;data:AppWheel;onSaved:(d:AppWheel)=>void}){
  const [draft,setDraft]=useState<Draft>(()=>toDraft(data.settings)),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false),[message,setMessage]=useState({error:'',ok:''})
  useEffect(()=>{setDraft(toDraft(data.settings))},[data])
  const canWrite=session.capabilities.writes&&data.writesEnabled
  const invalid=problem(draft),dirty=JSON.stringify(draft)!==JSON.stringify(toDraft(data.settings))
  const total=Object.values(draft.chances).reduce((sum,value)=>sum+hundredths(value),0)/100
  const change=(patch:Partial<Draft>)=>{setDraft({...draft,...patch});setMessage({error:'',ok:''})}
  const stats=data.last30Days
  async function save(){
    setConfirm(false);setBusy(true);setMessage({error:'',ok:''})
    try{
      const saved=await apiPut<AppWheel>(`/api/admin/venues/${venue.id}/app/wheel`,{
        chances:Object.fromEntries(Object.entries(draft.chances).map(([code,value])=>[code,Number(value)])),
        firstPaidCost:Number(draft.firstPaidCost),nextPaidCost:Number(draft.nextPaidCost),freeIntervalHours:Number(draft.freeIntervalHours)})
      onSaved({...saved,writesEnabled:data.writesEnabled});setMessage({error:'',ok:'Сохранено в приложении. Гости увидят новые шансы и цены в правилах колеса в течение минуты.'})
    }catch(e){setMessage({error:e instanceof Error?e.message:'Не удалось сохранить.',ok:''})}
    finally{setBusy(false)}
  }
  return <div className="page">
    <PageHead eyebrow="КОЛЕСО ФОРТУНЫ" title="Колесо" sub={`${venue.companyName} → ${venue.name} · ${num(stats.spins)} вращений за 30 дней`}
      actions={<><WriteGatePill enabled={canWrite}/><button className="btn" disabled={!canWrite||!dirty||Boolean(invalid)||busy} onClick={()=>setConfirm(true)}><Save/>{busy?'Сохраняем…':'Сохранить'}</button></>}/>
    <LinkedToAppNote/>
    {message.error&&<div className="login-error">{message.error}</div>}
    {message.ok&&<div className="save-success">{message.ok}</div>}
    <div className="wheel-top">
      <section className="card wheel-visual">
        <div className="wheel-ring"><div className="wheel-center"><Gift/><b>ПРИЗЫ</b></div></div>
        <div className="prob-total"><span>Сумма шансов</span><strong className={Math.abs(total-100)<1e-9?'':'bad'}>{percent(total)}</strong>
          <small>{Math.abs(total-100)<1e-9?'Шансы настроены корректно':'Сумма должна быть 100%'}</small></div>
      </section>
      <section className="card editor-card">
        <div className="card-title"><div><h3>Вращения</h3><p>Бесплатное вращение возвращается через заданное время. Между бесплатными гость может крутить за бонусы.</p></div></div>
        <div className="wheel-settings">
          <label className="field"><span>Бесплатное раз в, часов</span><input type="number" min={1} max={168} disabled={!canWrite} value={draft.freeIntervalHours} onChange={e=>change({freeIntervalHours:e.target.value})}/></label>
          <label className="field"><span>Первое платное, бонусов</span><input type="number" min={1} max={10000} disabled={!canWrite} value={draft.firstPaidCost} onChange={e=>change({firstPaidCost:e.target.value})}/></label>
          <label className="field"><span>Следующие, бонусов</span><input type="number" min={1} max={10000} disabled={!canWrite} value={draft.nextPaidCost} onChange={e=>change({nextPaidCost:e.target.value})}/></label>
        </div>
        <div className="mini-stats">
          <div><span>Гостей крутили</span><b>{num(stats.guests)}</b><small>за 30 дней</small></div>
          <div><span>Потрачено бонусов</span><b>{num(stats.bonusSpent)}</b><small>{num(stats.paidSpins)} платных вращений</small></div>
          <div><span>Выиграно</span><b>{num(stats.bonusAwarded)}</b><small>бонусов · {(stats.beerAwardedMl/1000).toLocaleString('ru-RU')} л пива</small></div>
        </div>
      </section>
    </div>
    <section className="card editor-card">
      <div className="card-title"><div><h3>Шансы призов</h3><p>Сумма шансов обычных призов — 100%. Призы и их размер нарисованы на колесе, поэтому меняются только шансы.</p></div></div>
      <div className="reward-list">
        {data.prizes.map(prize=>prize.annualSupply
          ?<div className="reward-row wheel-chance-row" key={prize.code}>
            <div><b>{prize.title}</b><small>{reward(prize)}</small></div>
            <span className="wheel-chance-fixed">1 из 1 000 000</span><span/>
          </div>
          :<div className="reward-row wheel-chance-row" key={prize.code}>
            <div><b>{prize.title}</b><small>{reward(prize)}</small></div>
            <label className="field"><span>Шанс, %</span><input type="number" min={0} max={100} step={0.01} disabled={!canWrite} value={draft.chances[prize.code]??''}
              onChange={e=>change({chances:{...draft.chances,[prize.code]:e.target.value}})}/></label>
            <span className="wheel-chance-now">сейчас {percent(prize.chancePercent)}</span>
          </div>)}
      </div>
      {invalid&&<div className="validation"><AlertTriangle/>{invalid}</div>}
      <SourceNote>Главный приз всегда 1 из 1 000 000: его билет берётся из доли бокала пива. Правила колеса в приложении показывают действующие шансы и цены.</SourceNote>
    </section>
    {data.updatedAt&&<SourceNote>Последнее изменение: {dt(data.updatedAt)}{data.updatedBy?`, ${data.updatedBy}`:''}.</SourceNote>}
    {confirm&&<ConfirmModal title="Сохранить колесо?" text="Новые шансы и цены начнут действовать для всех гостей в течение минуты." onCancel={()=>setConfirm(false)} onConfirm={()=>void save()}/>}
  </div>
}
