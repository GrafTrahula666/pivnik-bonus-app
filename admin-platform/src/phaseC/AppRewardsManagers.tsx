import { useEffect,useState } from 'react'
import { AlertTriangle,Award,Frame,Plus,Save,Trash2,Trophy,X } from 'lucide-react'
import type { AdminSession,ApiVenue } from '../api'
import { apiDelete,apiGet,apiPost,apiPut } from '../api'
import { ConfirmModal,EditorModal,PageHead,Toggle,cn } from '../ui'
import { ErrorCard,LoadingCard,SourceNote,WriteGatePill,dt,num,useResource } from './common'
import { businessLabel } from './labels'
import { LinkedToAppNote } from './AppContentManagers'
import { PivnikLegacyAchievementManager } from './PivnikLegacyManagers'

// Achievements and frames of the PIVNIK app. Changes go to the app itself: guests see them in their profile.

interface AppAchievement {
  code:string;title:string;description:string;rarity:string;metric:string;target:number;unit:string;recurring:string|null
  rewardBonus:number;rewardBeerMl:number;defaultRewardBonus:number|null;enabled:boolean;manual:boolean;guests:number
}
interface AppFrame {code:string;title:string;guests:number}
interface AppRewards {achievements:AppAchievement[];frames:AppFrame[];updatedAt:string|null;updatedBy:string|null;writesEnabled:boolean}
type RewardsResponse=(AppRewards&{configured:true})|{configured:false}
interface GuestRewards {
  selectedFrame:string
  achievements:Array<{code:string;title:string;grantedAt:string;times:number}>
  frames:Array<{code:string;title:string;source:string;acquiredAt:string;removable:boolean}>
}

const RARITIES:Array<[string,string]>=[['common','Обычное'],['rare','Редкое'],['epic','Эпическое'],['legendary','Легендарное']]
function Head({title,sub}:{title:string;sub:string}){return <div className="card-title"><div><h3>{title}</h3><p>{sub}</p></div></div>}
const failed=(e:unknown,fallback='Не удалось сохранить.')=>e instanceof Error?e.message:fallback
const rubles=(cents:number)=>new Intl.NumberFormat('ru-RU').format(Math.round(cents/100))

export function achievementCondition(a:Pick<AppAchievement,'metric'|'target'|'recurring'|'manual'>){
  if(a.manual)return 'выдаётся вручную'
  switch(a.metric){
    case 'purchaseCount':return a.target===1?'первая покупка':`${num(a.target)} покупок`
    case 'maxCheckCents':return `один чек от ${rubles(a.target)} ₽`
    case 'paidBeerMl':return `${num(a.target/1000)} л оплаченного разливного`
    case 'redemptionCount':return 'впервые потратить бонусы'
    case 'totalSpendCents':return `покупки на ${rubles(a.target)} ₽`
    case 'purchaseDays':return `покупки в ${num(a.target)} разных дней`
    case 'bonusSpent':return `потратить ${num(a.target)} бонусов`
    case 'previousMonthWinner':return '1-е место по покупкам за месяц'
    default:return a.recurring?'каждый месяц':'автоматически'
  }
}
const rewardText=(a:Pick<AppAchievement,'rewardBonus'|'rewardBeerMl'>)=>
  a.rewardBeerMl?`${(a.rewardBeerMl/1000).toLocaleString('ru-RU')} л пива${a.rewardBonus?` + ${num(a.rewardBonus)} бонусов`:''}`:`+${num(a.rewardBonus)} бонусов`

export function AppAchievementsManager({venue,session}:{venue:ApiVenue;session:AdminSession}){
  const {data,error,loading,reload,setData}=useResource<RewardsResponse>(`/api/admin/venues/${venue.id}/app/rewards`)
  if(loading&&!data)return <LoadingCard/>
  if(error&&!data)return <ErrorCard error={error} onRetry={reload}/>
  if(!data)return null
  if(!data.configured)return <>
    <div className="safety-note panel-only-note"><AlertTriangle/><span>Панель не связана с приложением (нужны PIVNIK_APP_URL и BUSINESS_INTERNAL_TOKEN), поэтому достижения сейчас только для просмотра.</span></div>
    <PivnikLegacyAchievementManager venue={venue}/>
  </>
  return <LinkedAchievements venue={venue} session={session} data={data} setData={setData}/>
}

function LinkedAchievements({venue,session,data,setData}:{venue:ApiVenue;session:AdminSession;data:AppRewards;setData:(value:RewardsResponse)=>void}){
  const base=`/api/admin/venues/${venue.id}/app/rewards`
  const [items,setItems]=useState<AppAchievement[]|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState({error:'',ok:''})
  const [edit,setEdit]=useState<AppAchievement|null>(null),[remove,setRemove]=useState<AppAchievement|null>(null)
  useEffect(()=>{setItems(data.achievements)},[data])
  if(!items)return null
  const canWrite=session.capabilities.writes&&data.writesEnabled
  const dirty=JSON.stringify(items)!==JSON.stringify(data.achievements)
  const auto=items.filter(x=>!x.manual),own=items.filter(x=>x.manual)
  const change=(code:string,patch:Partial<AppAchievement>)=>{setItems(items.map(x=>x.code===code?{...x,...patch}:x));setMessage({error:'',ok:''})}

  async function save(){
    setBusy(true);setMessage({error:'',ok:''})
    try{const saved=await apiPut<AppRewards>(`${base}/achievements`,{achievements:items});setData({...saved,configured:true,writesEnabled:data.writesEnabled});setMessage({error:'',ok:'Сохранено в приложении. Гости увидят изменения при следующем открытии.'})}
    catch(e){setMessage({error:failed(e),ok:''})}
    finally{setBusy(false)}
  }
  function applyEdit(){
    if(!edit)return
    if(!edit.title.trim()){setMessage({error:'Введите название достижения.',ok:''});return}
    const list=items!;setItems(list.some(x=>x.code===edit.code)?list.map(x=>x.code===edit.code?edit:x):[...list,edit]);setEdit(null);setMessage({error:'',ok:''})
  }
  const blank=():AppAchievement=>({code:`custom-${Date.now().toString(36)}`,title:'',description:'',rarity:'rare',metric:'manual',target:1,unit:'count',recurring:null,
    rewardBonus:100,rewardBeerMl:0,defaultRewardBonus:null,enabled:true,manual:true,guests:0})

  return <div className="page">
    <PageHead eyebrow="ДОСТИЖЕНИЯ ГОСТЕЙ" title="Достижения" sub={`${venue.companyName} → ${venue.name} · ${items.filter(x=>x.enabled&&!x.manual).length} автоматических, ${own.length} своих`}
      actions={<><WriteGatePill enabled={canWrite}/><button className="btn" disabled={!canWrite||!dirty||busy} onClick={()=>void save()}><Save/>{busy?'Сохраняем…':'Сохранить'}</button></>}/>
    <LinkedToAppNote/>
    {message.error&&<div className="login-error">{message.error}</div>}
    {message.ok&&<div className="save-success">{message.ok}</div>}
    <section className="card editor-card">
      <Head title="Автоматические" sub="Гость получает их сам, когда выполнит условие. Награда приходит на бонусный счёт."/>
      <div className="reward-list">
        {auto.map(a=><div key={a.code} className={cn('reward-row',!a.enabled&&'row-muted')}>
          <div className="reward-main"><b>{a.title}</b><small className="reward-sub">{businessLabel(a.rarity)} · {achievementCondition(a)} · получили: {num(a.guests)}</small></div>
          <div className="reward-bonus">{a.rewardBeerMl?<span>{rewardText(a)}</span>:<label><input className="reward-input" type="number" min={0} max={100000} disabled={!canWrite} value={a.rewardBonus} aria-label={`Награда за «${a.title}»`}
            onChange={e=>change(a.code,{rewardBonus:Math.max(0,Math.round(Number(e.target.value)||0))})}/><span>бонусов</span></label>}
            {a.defaultRewardBonus!==null&&a.rewardBonus!==a.defaultRewardBonus&&!a.rewardBeerMl&&<small className="reward-sub">было {num(a.defaultRewardBonus)}</small>}</div>
          <Toggle value={a.enabled} onChange={v=>canWrite&&change(a.code,{enabled:v})}/>
        </div>)}
      </div>
      <SourceNote>Выключенное достижение больше не выдаётся, но остаётся у гостей, которые его уже получили.</SourceNote>
    </section>
    <section className="card editor-card">
      <div className="card-title"><div><h3>Свои достижения</h3><p>Их выдаёте вы: в разделе «Клиенты» откройте гостя и нажмите «Выдать достижение».</p></div>
        <button className="btn secondary" disabled={!canWrite} onClick={()=>setEdit(blank())}><Plus/>Добавить</button></div>
      {!own.length?<p className="muted-copy">Своих достижений пока нет. Например: «Душа компании», «Гость месяца», «День рождения в Пивнике».</p>:
      <div className="achievement-grid">{own.map(a=><article className="card achievement-card" key={a.code}>
        <div className="achievement-icon"><Award/></div>
        <div className="grow">
          <div className="achievement-title"><h3>{a.title}</h3><span className="status ok">{businessLabel(a.rarity)}</span></div>
          <p>{a.description||'Без описания'}</p>
          <div className="achievement-meta"><span>{rewardText(a)}</span><span>получили: {num(a.guests)}</span></div>
          {canWrite&&<div className="row-actions">
            <button className="btn secondary" onClick={()=>setEdit({...a})}>Изменить</button>
            <button className="btn secondary danger-outline" disabled={a.guests>0} title={a.guests>0?'Уже есть у гостей':''} onClick={()=>setRemove(a)}><Trash2/>Удалить</button>
          </div>}
        </div>
      </article>)}</div>}
      {dirty&&<SourceNote>Не забудьте нажать «Сохранить» вверху страницы.</SourceNote>}
    </section>
    <section className="card editor-card">
      <Head title="Рамки профиля" sub="Выдать или забрать рамку можно в карточке гостя в разделе «Клиенты»."/>
      <div className="frame-list">{data.frames.map(f=><div className="setting-row" key={f.code}><div><b>{f.title}</b><span>{f.code}</span></div><span className="reward-sub">гостей с рамкой: <b>{num(f.guests)}</b></span></div>)}</div>
    </section>
    {data.updatedAt&&<SourceNote>Последнее изменение: {dt(data.updatedAt)}{data.updatedBy?`, ${data.updatedBy}`:''}.</SourceNote>}
    {edit&&<EditorModal title={items.some(x=>x.code===edit.code)?'Своё достижение':'Новое достижение'} onCancel={()=>setEdit(null)} onSave={applyEdit}>
      <label className="field"><span>Название</span><input maxLength={80} value={edit.title} onChange={e=>setEdit({...edit,title:e.target.value})}/></label>
      <label className="field"><span>Описание для гостя</span><textarea rows={3} maxLength={300} value={edit.description} onChange={e=>setEdit({...edit,description:e.target.value})}/></label>
      <div className="form-grid two">
        <label className="field"><span>Редкость</span><select value={edit.rarity} onChange={e=>setEdit({...edit,rarity:e.target.value})}>{RARITIES.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field"><span>Награда, бонусов</span><input type="number" min={0} max={100000} value={edit.rewardBonus} onChange={e=>setEdit({...edit,rewardBonus:Math.max(0,Math.round(Number(e.target.value)||0))})}/></label>
      </div>
    </EditorModal>}
    {remove&&<ConfirmModal title="Удалить достижение?" text={`«${remove.title}» пропадёт из списка после сохранения.`} onCancel={()=>setRemove(null)} onConfirm={()=>{setItems(items.filter(x=>x.code!==remove.code));setRemove(null)}}/>}
  </div>
}

// Rewards of one guest, shown in the client card.
export function GuestRewardsPanel({venue,session,userId,onChanged}:{venue:ApiVenue;session:AdminSession;userId:string;onChanged:()=>void}){
  const base=`/api/admin/venues/${venue.id}/clients/${userId}`
  const [rewards,setRewards]=useState<GuestRewards|null>(null),[catalog,setCatalog]=useState<AppRewards|null>(null),[error,setError]=useState(''),[ok,setOk]=useState('')
  const [dialog,setDialog]=useState<'achievement'|'frame'|null>(null),[revoke,setRevoke]=useState<GuestRewards['frames'][number]|null>(null)
  useEffect(()=>{
    setError('');setRewards(null)
    apiGet<RewardsResponse>(`/api/admin/venues/${venue.id}/app/rewards`).then(async c=>{
      if(!c.configured){setError('Панель не связана с приложением: выдавать достижения и рамки пока нельзя.');return}
      setCatalog(c);setRewards(await apiGet<GuestRewards>(`${base}/rewards`))
    }).catch(e=>setError(failed(e,'Не удалось загрузить награды гостя.')))
  },[base,venue.id])
  const canWrite=session.capabilities.writes&&Boolean(catalog?.writesEnabled)
  const done=(next:GuestRewards,text:string)=>{setRewards(next);setDialog(null);setOk(text);setError('');onChanged()}
  async function takeBack(frame:GuestRewards['frames'][number]){
    setRevoke(null)
    try{done(await apiDelete<GuestRewards>(`${base}/frames/${frame.code}`),`Рамка «${frame.title}» забрана.`)}catch(e){setError(failed(e))}
  }
  return <>
    <h3 className="section-title">Достижения и рамки</h3>
    {error&&<div className="inline-warning">{error}</div>}
    {ok&&<div className="save-success">{ok}</div>}
    {!rewards&&!error&&<p className="muted-copy">Загрузка…</p>}
    {rewards&&<>
      <div className="drawer-actions">
        <button className="btn secondary" disabled={!canWrite} onClick={()=>{setOk('');setDialog('achievement')}}><Trophy/>Выдать достижение</button>
        <button className="btn secondary" disabled={!canWrite} onClick={()=>{setOk('');setDialog('frame')}}><Frame/>Выдать рамку</button>
      </div>
      <div className="reward-chips">
        {rewards.achievements.map(a=><span className="reward-chip" key={a.code} title={dt(a.grantedAt)}><Trophy/>{a.title}{a.times>1?` ×${a.times}`:''}</span>)}
        {!rewards.achievements.length&&<span className="muted-copy">Достижений пока нет.</span>}
      </div>
      <div className="reward-chips">
        {rewards.frames.map(f=><span className={cn('reward-chip',rewards.selectedFrame===f.code&&'active')} key={f.code}><Frame/>{f.title}{rewards.selectedFrame===f.code?' · надета':''}
          {f.removable&&canWrite&&<button className="chip-remove" aria-label="Забрать рамку" onClick={()=>setRevoke(f)}><X/></button>}</span>)}
        {!rewards.frames.length&&<span className="muted-copy">Подаренных рамок нет.</span>}
      </div>
    </>}
    {dialog==='achievement'&&catalog&&rewards&&<GrantAchievementModal catalog={catalog} rewards={rewards} base={base} onCancel={()=>setDialog(null)} onDone={done}/>}
    {dialog==='frame'&&catalog&&rewards&&<GrantFrameModal catalog={catalog} rewards={rewards} base={base} onCancel={()=>setDialog(null)} onDone={done}/>}
    {revoke&&<ConfirmModal title="Забрать рамку?" text={`«${revoke.title}» пропадёт из профиля гостя.`} onCancel={()=>setRevoke(null)} onConfirm={()=>void takeBack(revoke)}/>}
  </>
}

function GrantAchievementModal({catalog,rewards,base,onCancel,onDone}:{catalog:AppRewards;rewards:GuestRewards;base:string;onCancel:()=>void;onDone:(r:GuestRewards,text:string)=>void}){
  const owned=new Set(rewards.achievements.map(a=>a.code))
  const options=catalog.achievements.filter(a=>!owned.has(a.code)&&!a.recurring).sort((a,b)=>Number(b.manual)-Number(a.manual))
  const [code,setCode]=useState(options[0]?.code||''),[confirm,setConfirm]=useState(false),[error,setError]=useState('')
  const picked=options.find(a=>a.code===code)
  async function submit(){
    setConfirm(false)
    try{const r=await apiPost<{granted:{title:string;rewardBonus:number};rewards:GuestRewards}>(`${base}/app-achievements`,{code})
      onDone(r.rewards,`Достижение «${r.granted.title}» выдано${r.granted.rewardBonus?`, начислено ${num(r.granted.rewardBonus)} бонусов`:''}.`)}
    catch(e){setError(failed(e,'Не удалось выдать достижение.'))}
  }
  return <>
    <EditorModal title="Выдать достижение" onCancel={onCancel} onSave={()=>picked&&setConfirm(true)}>
      {!options.length?<p className="muted-copy">У гостя уже есть все достижения, которые можно выдать.</p>:<>
        <label className="field"><span>Достижение</span><select value={code} onChange={e=>setCode(e.target.value)}>
          {options.map(a=><option key={a.code} value={a.code}>{a.manual?'★ ':''}{a.title} · {rewardText(a)}</option>)}</select></label>
        {picked&&<SourceNote>{picked.description||achievementCondition(picked)}. Гость увидит поздравление в приложении, награда придёт на счёт.</SourceNote>}
      </>}
      {error&&<div className="login-error">{error}</div>}
    </EditorModal>
    {confirm&&picked&&<ConfirmModal title="Выдать достижение?" text={`«${picked.title}» и ${rewardText(picked)}. Выдать можно один раз, отменить нельзя.`} onCancel={()=>setConfirm(false)} onConfirm={()=>void submit()}/>}
  </>
}

function GrantFrameModal({catalog,rewards,base,onCancel,onDone}:{catalog:AppRewards;rewards:GuestRewards;base:string;onCancel:()=>void;onDone:(r:GuestRewards,text:string)=>void}){
  const owned=new Set(rewards.frames.map(f=>f.code))
  const options=catalog.frames.filter(f=>!owned.has(f.code))
  const [code,setCode]=useState(options[0]?.code||''),[error,setError]=useState('')
  async function submit(){
    const frame=options.find(f=>f.code===code);if(!frame)return
    try{onDone(await apiPost<GuestRewards>(`${base}/frames`,{code}),`Рамка «${frame.title}» выдана: гость может выбрать её в профиле.`)}
    catch(e){setError(failed(e,'Не удалось выдать рамку.'))}
  }
  return <EditorModal title="Выдать рамку" onCancel={onCancel} onSave={()=>void submit()}>
    {!options.length?<p className="muted-copy">У гостя уже есть все рамки.</p>:
      <label className="field"><span>Рамка</span><select value={code} onChange={e=>setCode(e.target.value)}>{options.map(f=><option key={f.code} value={f.code}>{f.title}</option>)}</select></label>}
    <SourceNote>Рамка появится у гостя в профиле в списке рамок. Её можно будет забрать.</SourceNote>
    {error&&<div className="login-error">{error}</div>}
  </EditorModal>
}
