import { useEffect,useState } from 'react'
import { AlertTriangle,Plus,Save,Trash2 } from 'lucide-react'
import type { AdminSession,ApiVenue } from '../api'
import { apiPut } from '../api'
import { ConfirmModal,PageHead } from '../ui'
import { ErrorCard,LoadingCard,SourceNote,WriteGatePill,dt,num,useResource } from './common'
import { LinkedToAppNote } from './AppContentManagers'
import { LoyaltyManager } from './ProductionManagers'

// Status levels and the welcome bonus of the PIVNIK app: what a guest earns on every purchase.

interface Level {name:string;minCents:number;bonusPercent:number;discountPercent:number;guests:number}
interface AppLoyalty {levels:Level[];welcomeBonus:number;updatedAt:string|null;updatedBy:string|null;writesEnabled:boolean}
type LoyaltyResponse=(AppLoyalty&{configured:true})|{configured:false}
interface Draft {levels:Array<{key:string;name:string;minRub:string;bonusPercent:string;discountPercent:string;guests:number}>;welcomeBonus:string}

const toDraft=(d:AppLoyalty):Draft=>({welcomeBonus:String(d.welcomeBonus),levels:d.levels.map((l,i)=>({key:`${i}-${l.name}`,name:l.name,minRub:String(l.minCents/100),
  bonusPercent:String(l.bonusPercent),discountPercent:String(l.discountPercent),guests:l.guests}))})
function problem(draft:Draft):string{
  if(!draft.levels.length)return 'Нужен хотя бы один уровень.'
  let prev=-1
  for(const [i,l] of draft.levels.entries()){
    if(!l.name.trim())return `Уровень ${i+1}: введите название.`
    const min=Number(l.minRub)
    if(!Number.isInteger(min)||min<0)return `«${l.name}»: порог в целых рублях.`
    if(i===0&&min!==0)return 'Первый уровень должен начинаться с 0 ₽.'
    if(min<=prev)return 'Пороги должны расти сверху вниз.'
    prev=min
    for(const v of [l.bonusPercent,l.discountPercent]){const p=Number(v);if(!Number.isFinite(p)||p<0||p>50)return `«${l.name}»: проценты от 0 до 50.`}
  }
  const w=Number(draft.welcomeBonus)
  if(!Number.isInteger(w)||w<0||w>10000)return 'Приветственный бонус: от 0 до 10 000.'
  return ''
}

export function AppLoyaltyManager({venue,session}:{venue:ApiVenue;session:AdminSession}){
  const {data,error,loading,reload,setData}=useResource<LoyaltyResponse>(`/api/admin/venues/${venue.id}/app/loyalty`)
  if(loading&&!data)return <LoadingCard/>
  if(error&&!data)return <ErrorCard error={error} onRetry={reload}/>
  if(!data)return null
  if(!data.configured)return <LoyaltyManager venue={venue} session={session}/>
  return <LinkedLoyalty venue={venue} session={session} data={data} onSaved={saved=>setData({...saved,configured:true,writesEnabled:data.writesEnabled})}/>
}

function LinkedLoyalty({venue,session,data,onSaved}:{venue:ApiVenue;session:AdminSession;data:AppLoyalty;onSaved:(d:AppLoyalty)=>void}){
  const [draft,setDraft]=useState<Draft>(()=>toDraft(data)),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false),[message,setMessage]=useState({error:'',ok:''})
  useEffect(()=>{setDraft(toDraft(data))},[data])
  const canWrite=session.capabilities.writes&&data.writesEnabled
  const invalid=problem(draft),dirty=JSON.stringify(draft)!==JSON.stringify(toDraft(data))
  const update=(i:number,patch:Partial<Draft['levels'][number]>)=>{setDraft({...draft,levels:draft.levels.map((l,j)=>j===i?{...l,...patch}:l)});setMessage({error:'',ok:''})}
  async function save(){
    setConfirm(false);setBusy(true);setMessage({error:'',ok:''})
    try{
      const saved=await apiPut<AppLoyalty>(`/api/admin/venues/${venue.id}/app/loyalty`,{welcomeBonus:Number(draft.welcomeBonus),
        levels:draft.levels.map(l=>({name:l.name.trim(),minCents:Number(l.minRub)*100,bonusPercent:Number(l.bonusPercent),discountPercent:Number(l.discountPercent)}))})
      onSaved({...saved,writesEnabled:data.writesEnabled});setMessage({error:'',ok:'Сохранено в приложении. Новые проценты действуют со следующей покупки.'})
    }catch(e){setMessage({error:e instanceof Error?e.message:'Не удалось сохранить.',ok:''})}
    finally{setBusy(false)}
  }
  const last=draft.levels.at(-1)
  return <div className="page">
    <PageHead eyebrow="ПРОГРАММА ЛОЯЛЬНОСТИ" title="Лояльность" sub={`${venue.companyName} → ${venue.name} · ${draft.levels.length} уровней`}
      actions={<><WriteGatePill enabled={canWrite}/><button className="btn" disabled={!canWrite||!dirty||Boolean(invalid)||busy} onClick={()=>setConfirm(true)}><Save/>{busy?'Сохраняем…':'Сохранить'}</button></>}/>
    <LinkedToAppNote/>
    {message.error&&<div className="login-error">{message.error}</div>}
    {message.ok&&<div className="save-success">{message.ok}</div>}
    <section className="card editor-card">
      <div className="card-title"><div><h3>Уровни гостей</h3><p>Уровень зависит от суммы покупок за последние 12 месяцев. С каждой покупки гость получает бонусы по проценту своего уровня.</p></div>
        <button className="btn secondary" disabled={!canWrite||draft.levels.length>=12} onClick={()=>setDraft({...draft,levels:[...draft.levels,{key:`new-${Date.now()}`,name:'',
          minRub:String(Number(last?.minRub||0)+50000),bonusPercent:last?.bonusPercent||'5',discountPercent:'0',guests:0}]})}><Plus/>Уровень</button></div>
      <div className="level-builder loyalty-list">
        {draft.levels.map((l,i)=><div className="loyalty-row" key={l.key}>
          <label className="field"><span>Уровень {i+1}</span><input maxLength={40} disabled={!canWrite} value={l.name} onChange={e=>update(i,{name:e.target.value})}/></label>
          <label className="field"><span>От, ₽</span><input type="number" min={0} disabled={!canWrite||i===0} value={l.minRub} onChange={e=>update(i,{minRub:e.target.value})}/></label>
          <label className="field"><span>Бонусы, %</span><input type="number" min={0} max={50} step={0.1} disabled={!canWrite} value={l.bonusPercent} onChange={e=>update(i,{bonusPercent:e.target.value})}/></label>
          <label className="field"><span>Скидка, %</span><input type="number" min={0} max={50} step={0.1} disabled={!canWrite} value={l.discountPercent} onChange={e=>update(i,{discountPercent:e.target.value})}/></label>
          <div className="loyalty-guests"><span>Гостей</span><b>{num(l.guests)}</b></div>
          <button className="icon-btn" aria-label="Удалить уровень" disabled={!canWrite||draft.levels.length<2||i===0} onClick={()=>setDraft({...draft,levels:draft.levels.filter((_,j)=>j!==i)})}><Trash2/></button>
        </div>)}
      </div>
      {invalid&&<div className="validation"><AlertTriangle/>{invalid}</div>}
      <SourceNote>Скидка применяется, когда сотрудник проводит покупку в приложении. Касса Эвотор начисляет только бонусы.</SourceNote>
    </section>
    <section className="card editor-card">
      <div className="card-title"><div><h3>Приветственный бонус</h3><p>Начисляется один раз, когда новый гость принимает правила. 0 — не начислять.</p></div></div>
      <label className="field loyalty-welcome"><span>Бонусов</span><input type="number" min={0} max={10000} disabled={!canWrite} value={draft.welcomeBonus} onChange={e=>{setDraft({...draft,welcomeBonus:e.target.value});setMessage({error:'',ok:''})}}/></label>
      <SourceNote>Если меняете сумму, поправьте и текст акции про приветственный бонус в разделе «Акции».</SourceNote>
    </section>
    {data.updatedAt&&<SourceNote>Последнее изменение: {dt(data.updatedAt)}{data.updatedBy?`, ${data.updatedBy}`:''}.</SourceNote>}
    {confirm&&<ConfirmModal title="Сохранить уровни?" text="Новые проценты начисления и скидки сразу начнут действовать для всех гостей." onCancel={()=>setConfirm(false)} onConfirm={()=>void save()}/>}
  </div>
}
