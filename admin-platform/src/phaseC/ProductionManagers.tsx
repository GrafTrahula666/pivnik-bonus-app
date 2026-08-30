import { useEffect,useMemo,useState,type CSSProperties } from 'react'
import {
  AlertTriangle,Gift,GripVertical,Pencil,Plus,Save,ShieldCheck,
  ShoppingBag,TicketPercent,Trophy,
} from 'lucide-react'
import type { AdminSession,ApiVenue } from '../api'
import { apiPut } from '../api'
import {
  CardTitle,EditorModal,Field,PageHead,Status,Toggle,cn,rub,
} from '../ui'
import {
  ErrorCard,LoadingCard,SourceNote,WriteGatePill,imageFileToDataUrl,useResource,
} from './common'
import { businessLabel,rewardSummary } from './labels'

type SaveState={busy:boolean;error:string;ok:string}
const initialSave:SaveState={busy:false,error:'',ok:''}
function SaveMessage({state}:{state:SaveState}){
  if(state.error)return <div className="login-error">{state.error}</div>
  if(state.ok)return <div className="save-success">{state.ok}</div>
  return null
}
const newCode=(prefix:string)=>`${prefix}-${crypto.randomUUID().slice(0,8)}`

interface LoyaltyLevel {
  code:string;title:string;thresholdRub:number;bonusPercent:number;discountPercent:number;enabled:boolean;sortOrder:number
}
interface LoyaltyData {
  source:string;editable:boolean;baseCashbackPercent:number;registrationBonus:number;referralBonus:number;levels:LoyaltyLevel[]
}
export function LoyaltyManager({venue,session}:{venue:ApiVenue;session:AdminSession}){
  const path=`/api/admin/venues/${venue.id}/loyalty/manage`
  const {data,error,loading,reload,setData}=useResource<LoyaltyData>(path)
  const [draft,setDraft]=useState<LoyaltyData|null>(null),[save,setSave]=useState(initialSave),[confirm,setConfirm]=useState(false)
  useEffect(()=>{if(data)setDraft(structuredClone(data))},[data])
  const invalid=useMemo(()=>{
    if(!draft)return ''
    const active=[...draft.levels].filter(x=>x.enabled).sort((a,b)=>a.sortOrder-b.sortOrder)
    for(let i=1;i<active.length;i++)if(active[i]!.thresholdRub<=active[i-1]!.thresholdRub)return 'Пороги активных уровней должны строго возрастать.'
    if(new Set(draft.levels.map(x=>x.code)).size!==draft.levels.length)return 'Коды уровней должны быть уникальны.'
    return ''
  },[draft])
  async function persist(){
    if(!draft||invalid)return
    setSave({busy:true,error:'',ok:''})
    try{
      const saved=await apiPut<LoyaltyData>(path,draft)
      setData(saved);setDraft(structuredClone(saved));setSave({busy:false,error:'',ok:'Настройки программы лояльности сохранены.'});setConfirm(false)
    }catch(e){setSave({busy:false,error:e instanceof Error?e.message:'Не удалось сохранить изменение.',ok:''});setConfirm(false)}
  }
  if(loading&&!draft)return <LoadingCard/>
  if(error&&!draft)return <ErrorCard error={error} onRetry={reload}/>
  if(!draft)return null
  const update=(index:number,patch:Partial<LoyaltyLevel>)=>setDraft({...draft,levels:draft.levels.map((x,i)=>i===index?{...x,...patch}:x)})
  return <div className="page">
    <PageHead eyebrow="ПРОГРАММА ЛОЯЛЬНОСТИ" title="Лояльность"
      sub={`${venue.companyName} → ${venue.name}`}
      actions={<><WriteGatePill enabled={session.capabilities.writes}/><button className="btn" disabled={!session.capabilities.writes||Boolean(invalid)||save.busy} onClick={()=>setConfirm(true)}><Save/>Сохранить</button></>}/>
    <section className="card editor-card">
      <CardTitle title="Базовые правила"/>
      <div className="form-grid three">
        <Field label="Базовый кешбэк, %" type="number" value={draft.baseCashbackPercent} onChange={v=>setDraft({...draft,baseCashbackPercent:Number(v)})}/>
        <Field label="Бонус регистрации" type="number" value={draft.registrationBonus} onChange={v=>setDraft({...draft,registrationBonus:Number(v)})}/>
        <Field label="Бонус за рекомендацию" type="number" value={draft.referralBonus} onChange={v=>setDraft({...draft,referralBonus:Number(v)})}/>
      </div>
      <SourceNote>{draft.source==='legacy-fallback'?'Показаны действующие параметры заведения. Изменения вступят в силу после отдельного подтверждения запуска.':'Настройки сохранены и готовы к использованию.'}</SourceNote>
    </section>
    <section className="card editor-card">
      <CardTitle title="Уровни" action="+ Добавить" onAction={()=>setDraft({...draft,levels:[...draft.levels,{code:newCode('level'),title:'Новый уровень',thresholdRub:(draft.levels.at(-1)?.thresholdRub||0)+50000,bonusPercent:5,discountPercent:0,enabled:true,sortOrder:draft.levels.length}]})}/>
      <div className="level-builder">
        {draft.levels.map((level,index)=><div className="level-row phase-level-row" key={level.code}>
          <GripVertical/><span className="level-index">{String(index+1).padStart(2,'0')}</span>
          <input value={level.title} onChange={e=>update(index,{title:e.target.value})}/>
          <label><span>Порог ₽</span><input type="number" value={level.thresholdRub} onChange={e=>update(index,{thresholdRub:Number(e.target.value)})}/></label>
          <label><span>Кешбэк %</span><input type="number" step=".01" value={level.bonusPercent} onChange={e=>update(index,{bonusPercent:Number(e.target.value)})}/></label>
          <label><span>Скидка %</span><input type="number" step=".01" value={level.discountPercent} onChange={e=>update(index,{discountPercent:Number(e.target.value)})}/></label>
          <Toggle value={level.enabled} onChange={v=>update(index,{enabled:v})}/>
          <button className="ghost-icon" onClick={()=>setDraft({...draft,levels:draft.levels.filter((_,i)=>i!==index).map((x,i)=>({...x,sortOrder:i}))})}>×</button>
        </div>)}
      </div>
      {invalid&&<div className="validation"><AlertTriangle/>{invalid}</div>}
      <SaveMessage state={save}/>
    </section>
    {confirm&&<div className="modal-layer"><button className="modal-scrim" onClick={()=>setConfirm(false)}/><div className="modal confirm">
      <div className="confirm-icon"><ShieldCheck/></div><h3>Сохранить настройки лояльности?</h3><p>{venue.companyName} → {venue.name}. Проверьте параметры уровней и базовых начислений перед сохранением.</p>
      <div className="modal-actions"><button className="btn secondary" onClick={()=>setConfirm(false)}>Отмена</button><button className="btn" onClick={()=>void persist()}>Сохранить</button></div>
    </div></div>}
  </div>
}

interface WheelPrize {code:string;title:string;rewardType:string;rewardValue:Record<string,unknown>;probability:string;inventoryLimit:number|null;enabled:boolean;sortOrder:number}
interface WheelData {source:string;enabled:boolean|null;cooldownMinutes:number|null;retryCost:number|null;version:number;prizes:WheelPrize[]}
export function WheelManager({venue,session}:{venue:ApiVenue;session:AdminSession}){
  const path=`/api/admin/venues/${venue.id}/wheel/manage`
  const {data,error,loading,reload,setData}=useResource<WheelData>(path)
  const [draft,setDraft]=useState<WheelData|null>(null),[save,setSave]=useState(initialSave),[confirm,setConfirm]=useState(false)
  useEffect(()=>{if(data)setDraft(structuredClone(data))},[data])
  const total=useMemo(()=>draft?.prizes.filter(x=>x.enabled).reduce((sum,x)=>sum+Number(x.probability||0),0)||0,[draft])
  const totalOk=Math.abs(total-100)<1e-9
  if(loading&&!draft)return <LoadingCard/>
  if(error&&!draft)return <ErrorCard error={error} onRetry={reload}/>
  if(!draft)return null
  const update=(i:number,patch:Partial<WheelPrize>)=>setDraft({...draft,prizes:draft.prizes.map((x,j)=>j===i?{...x,...patch}:x)})
  const persist=async()=>{const current=draft;setSave({busy:true,error:'',ok:''});try{
    const saved=await apiPut<WheelData>(path,{enabled:current.enabled!==false,cooldownMinutes:current.cooldownMinutes??1440,retryCost:current.retryCost??0,prizes:current.prizes})
    setData(saved);setDraft(structuredClone(saved));setSave({busy:false,error:'',ok:'Настройки колеса опубликованы.'});setConfirm(false)
  }catch(e){setSave({busy:false,error:e instanceof Error?e.message:'Не удалось сохранить.',ok:''});setConfirm(false)}}
  return <div className="page">
    <PageHead eyebrow="КОНСТРУКТОР ПРИЗОВ" title="Колесо" sub={`${venue.companyName} → ${venue.name}`}
      actions={<><WriteGatePill enabled={session.capabilities.writes}/><button className="btn" disabled={!session.capabilities.writes||!totalOk||save.busy} onClick={()=>setConfirm(true)}><Save/>Опубликовать</button></>}/>
    <div className="wheel-top">
      <section className="card wheel-visual"><div className="wheel-ring"><div className="wheel-center"><Gift/><b>ПРИЗЫ</b></div></div><div className="prob-total"><span>Сумма вероятностей</span><strong className={!totalOk?'bad':''}>{total.toFixed(Math.min(7,(String(total).split('.')[1]||'').length))}%</strong><small>{totalOk?'Готово к публикации':'Должно быть ровно 100%'}</small></div></section>
      <section className="card editor-card"><CardTitle title="Механика"/>
        <div className="setting-row"><div><b>Колесо включено</b><span>Доступность для гостей настраивается отдельно</span></div><Toggle value={draft.enabled!==false} onChange={v=>setDraft({...draft,enabled:v})}/></div>
        <div className="form-grid two"><Field label="Перерыв, минут" type="number" value={draft.cooldownMinutes??1440} onChange={v=>setDraft({...draft,cooldownMinutes:Number(v)})}/><Field label="Повторная попытка, бонусов" type="number" value={draft.retryCost??0} onChange={v=>setDraft({...draft,retryCost:Number(v)})}/></div>
        <SourceNote>Даже самые редкие призы сохраняются с высокой точностью вероятности.</SourceNote>
      </section>
    </div>
    <section className="card editor-card"><CardTitle title="Призы" action="+ Добавить приз" onAction={()=>setDraft({...draft,prizes:[...draft.prizes,{code:newCode('prize'),title:'Новый приз',rewardType:'bonus',rewardValue:{amount:100},probability:'0',inventoryLimit:null,enabled:true,sortOrder:draft.prizes.length}]})}/>
      <div className="prize-list"><div className="prize-head"><span>Приз</span><span>Тип</span><span>Награда</span><span>Вероятность</span><span>Лимит</span><span>Статус</span><span/></div>
        {draft.prizes.map((p,i)=><div className="prize-row" key={p.code}>
          <div className="prize-name"><div className="prize-icon"><Gift/></div><input value={p.title} onChange={e=>update(i,{title:e.target.value})}/></div>
          <select value={p.rewardType} onChange={e=>update(i,{rewardType:e.target.value})}>{['bonus','beer_ml','item','frame','retry','none'].map(x=><option key={x} value={x}>{businessLabel(x)}</option>)}</select>
          <input value={String((p.rewardValue as any).amount??(p.rewardValue as any).code??'')} onChange={e=>update(i,{rewardValue:p.rewardType==='bonus'||p.rewardType==='beer_ml'?{amount:Number(e.target.value)}:{code:e.target.value}})}/>
          <div className="input-suffix"><input inputMode="decimal" value={p.probability} onChange={e=>update(i,{probability:e.target.value})}/><i>%</i></div>
          <input type="number" placeholder="∞" value={p.inventoryLimit??''} onChange={e=>update(i,{inventoryLimit:e.target.value===''?null:Number(e.target.value)})}/>
          <Toggle value={p.enabled} onChange={v=>update(i,{enabled:v})}/><button className="ghost-icon" onClick={()=>setDraft({...draft,prizes:draft.prizes.filter((_,j)=>j!==i).map((x,j)=>({...x,sortOrder:j}))})}>×</button>
        </div>)}
      </div>
      {!totalOk&&<div className="validation"><AlertTriangle/>Публикация заблокирована: сумма вероятностей активных призов — {total}%.</div>}
      <SaveMessage state={save}/>
    </section>
    {confirm&&<div className="modal-layer"><button className="modal-scrim" onClick={()=>setConfirm(false)}/><div className="modal confirm"><div className="confirm-icon"><AlertTriangle/></div><h3>Опубликовать настройки колеса?</h3><p>{venue.companyName} → {venue.name}. Вероятности и награды будут сохранены как единый проверенный набор.</p><div className="modal-actions"><button className="btn secondary" onClick={()=>setConfirm(false)}>Отмена</button><button className="btn" onClick={()=>void persist()}>Опубликовать</button></div></div></div>}
  </div>
}

interface AchievementItem {id?:string;code:string;title:string;description:string;image_src?:string|null;imageSrc?:string|null;condition_type?:string;conditionType?:string;threshold_value?:number|null;thresholdValue?:number|null;reward_value?:Record<string,unknown>;rewardValue?:Record<string,unknown>;visibility:string;enabled:boolean;sort_order?:number;sortOrder?:number;legacy_code?:string|null;legacyCode?:string|null}
interface AchievementData {source:string;items:AchievementItem[]}
export function AchievementManager({venue,session}:{venue:ApiVenue;session:AdminSession}){
  const path=`/api/admin/venues/${venue.id}/achievements/manage`,{data,error,loading,reload,setData}=useResource<AchievementData>(path)
  const [items,setItems]=useState<AchievementItem[]>([]),[edit,setEdit]=useState<AchievementItem|null>(null),[save,setSave]=useState(initialSave)
  useEffect(()=>{if(data)setItems(data.items.map((x,i)=>({...x,conditionType:x.conditionType??x.condition_type??'purchase_count',thresholdValue:x.thresholdValue??x.threshold_value??1,rewardValue:x.rewardValue??x.reward_value??{},imageSrc:x.imageSrc??x.image_src??null,sortOrder:x.sortOrder??x.sort_order??i,legacyCode:x.legacyCode??x.legacy_code??null})))},[data])
  async function persist(next=items){setSave({busy:true,error:'',ok:''});try{const saved=await apiPut<AchievementData>(path,{items:next});setData(saved);setSave({busy:false,error:'',ok:'Настройки достижений сохранены.'})}catch(e){setSave({busy:false,error:e instanceof Error?e.message:'Не удалось сохранить.',ok:''})}}
  if(loading&&!data)return <LoadingCard/>;if(error&&!data)return <ErrorCard error={error} onRetry={reload}/>
  return <div className="page">
    <PageHead eyebrow="НАГРАДЫ ЗА АКТИВНОСТЬ" title="Достижения" sub={`${venue.companyName} → ${venue.name}`}
      actions={<><WriteGatePill enabled={session.capabilities.writes}/><button className="btn" disabled={!session.capabilities.writes||save.busy} onClick={()=>void persist()}><Save/>Сохранить</button><button className="btn secondary" onClick={()=>setEdit({code:newCode('achievement'),title:'',description:'',conditionType:'purchase_count',thresholdValue:1,rewardValue:{bonus:100},visibility:'public',enabled:true,sortOrder:items.length})}><Plus/>Достижение</button></>}/>
    <div className="achievement-grid">{items.map((x,i)=><article className="achievement-card card" key={x.code}>
      <div className={cn('achievement-icon',`rarity-${i%4}`)}><Trophy/></div><div className="grow"><div className="achievement-title"><span className="eyebrow">{businessLabel(x.conditionType)}</span><Status value={x.enabled?'Активен':'Пауза'}/></div><h3>{x.title}</h3><p>{x.description}</p><div className="achievement-meta"><span>Условие · {x.thresholdValue??'—'}</span><span>Награда · {rewardSummary(x.rewardValue)}</span><span>{x.visibility==='hidden'?'Скрытое':'Публичное'}</span></div></div>
      <button className="ghost-icon" onClick={()=>setEdit({...x})}><Pencil/></button>
    </article>)}</div>
    <SaveMessage state={save}/><SourceNote>Ручная выдача из карточки клиента требует подтверждения, защищена от повторов и фиксируется в журнале действий.</SourceNote>
    {edit&&<EditorModal title="Редактор достижения" onCancel={()=>setEdit(null)} onSave={()=>{const next=items.some(x=>x.code===edit.code)?items.map(x=>x.code===edit.code?edit:x):[...items,edit];setItems(next);setEdit(null)}}>
      <Field label="Код" value={edit.code} onChange={v=>setEdit({...edit,code:v})}/><Field label="Название" value={edit.title} onChange={v=>setEdit({...edit,title:v})}/><Field label="Описание" value={edit.description} onChange={v=>setEdit({...edit,description:v})}/>
      <Field label="Ссылка на изображение" value={edit.imageSrc||''} onChange={v=>setEdit({...edit,imageSrc:v||null})}/>
      <label className="field upload-field"><span>Или загрузить JPG / PNG / WEBP</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{const file=e.target.files?.[0];if(file)void imageFileToDataUrl(file).then(v=>setEdit({...edit,imageSrc:v})).catch(()=>undefined)}}/></label>
      <label className="field"><span>Тип условия</span><select value={edit.conditionType} onChange={e=>setEdit({...edit,conditionType:e.target.value})}>{['purchase_count','single_check','lifetime_spend','wheel_spin','shop_purchase','manual'].map(x=><option key={x} value={x}>{businessLabel(x)}</option>)}</select></label>
      <Field label="Порог" type="number" value={edit.thresholdValue??0} onChange={v=>setEdit({...edit,thresholdValue:Number(v)})}/>
      <Field label="Награда, бонусов" type="number" value={Number((edit.rewardValue as any)?.bonus||0)} onChange={v=>setEdit({...edit,rewardValue:{...(edit.rewardValue||{}),bonus:Number(v)}})}/>
      <div className="setting-row"><span>Активно</span><Toggle value={edit.enabled} onChange={v=>setEdit({...edit,enabled:v})}/></div><div className="setting-row"><span>Скрытое</span><Toggle value={edit.visibility==='hidden'} onChange={v=>setEdit({...edit,visibility:v?'hidden':'public'})}/></div>
    </EditorModal>}
  </div>
}

interface ShopItem {code:string;title:string;description:string;image_src?:string|null;imageSrc?:string|null;category:string;reward_type?:string;rewardType?:string;reward_value?:Record<string,unknown>;rewardValue?:Record<string,unknown>;bonus_price?:number;bonusPrice?:number;stock:number|null;purchase_limit?:number|null;purchaseLimit?:number|null;enabled:boolean;sort_order?:number;sortOrder?:number;legacy_code?:string|null;legacyCode?:string|null}
export function ShopManager({venue,session}:{venue:ApiVenue;session:AdminSession}){
  const path=`/api/admin/venues/${venue.id}/shop/manage`,{data,error,loading,reload,setData}=useResource<{source:string;items:ShopItem[]}>(path)
  const [items,setItems]=useState<ShopItem[]>([]),[edit,setEdit]=useState<ShopItem|null>(null),[save,setSave]=useState(initialSave)
  useEffect(()=>{if(data)setItems(data.items.map((x,i)=>({...x,imageSrc:x.imageSrc??x.image_src??null,rewardType:x.rewardType??x.reward_type??'item',rewardValue:x.rewardValue??x.reward_value??{},bonusPrice:Number(x.bonusPrice??x.bonus_price??0),purchaseLimit:x.purchaseLimit??x.purchase_limit??null,sortOrder:x.sortOrder??x.sort_order??i,legacyCode:x.legacyCode??x.legacy_code??null})))},[data])
  async function persist(){setSave({busy:true,error:'',ok:''});try{const saved=await apiPut<any>(path,{items});setData(saved);setSave({busy:false,error:'',ok:'Каталог магазина сохранён.'})}catch(e){setSave({busy:false,error:e instanceof Error?e.message:'Не удалось сохранить.',ok:''})}}
  if(loading&&!data)return <LoadingCard/>;if(error&&!data)return <ErrorCard error={error} onRetry={reload}/>
  return <div className="page"><PageHead eyebrow="КАТАЛОГ НАГРАД" title="Магазин" sub={`${venue.companyName} → ${venue.name}`}
    actions={<><WriteGatePill enabled={session.capabilities.writes}/><button className="btn" disabled={!session.capabilities.writes||save.busy} onClick={()=>void persist()}><Save/>Сохранить</button><button className="btn secondary" onClick={()=>setEdit({code:newCode('item'),title:'',description:'',category:'merch',rewardType:'item',rewardValue:{},bonusPrice:500,stock:10,purchaseLimit:null,enabled:true,sortOrder:items.length})}><Plus/>Товар</button></>}/>
    <div className="shop-grid">{items.map((x,i)=><article className="product-card card" key={x.code}><div className={cn('product-art',`art-${i%4}`)}><ShoppingBag/><span>{businessLabel(x.category)}</span><button className="icon-btn" onClick={()=>setEdit({...x})}><Pencil/></button></div>
      <div className="product-body"><div><h3>{x.title}</h3><Status value={x.enabled?'Активен':'Пауза'}/></div><p>{x.description}</p><div className="product-price"><strong>{rub.format(Number(x.bonusPrice||0))} <small>бонусов</small></strong><span>Остаток · {x.stock??'∞'}</span></div>
        <div className="reorder"><button disabled={i===0} onClick={()=>{const n=[...items];[n[i-1],n[i]]=[n[i]!,n[i-1]!];setItems(n.map((v,j)=>({...v,sortOrder:j})))}}>↑ Выше</button><button disabled={i===items.length-1} onClick={()=>{const n=[...items];[n[i],n[i+1]]=[n[i+1]!,n[i]!];setItems(n.map((v,j)=>({...v,sortOrder:j})))}}>↓ Ниже</button></div>
      </div></article>)}</div><SaveMessage state={save}/><SourceNote>Изменение каталога не затрагивает уже совершённые покупки гостей.</SourceNote>
    {edit&&<EditorModal title="Редактор товара" onCancel={()=>setEdit(null)} onSave={()=>{const next=items.some(x=>x.code===edit.code)?items.map(x=>x.code===edit.code?edit:x):[...items,edit];setItems(next);setEdit(null)}}>
      <Field label="Код" value={edit.code} onChange={v=>setEdit({...edit,code:v})}/><Field label="Название" value={edit.title} onChange={v=>setEdit({...edit,title:v})}/><Field label="Описание" value={edit.description} onChange={v=>setEdit({...edit,description:v})}/>
      <Field label="Ссылка на изображение" value={edit.imageSrc||''} onChange={v=>setEdit({...edit,imageSrc:v||null})}/><label className="field upload-field"><span>Или загрузить изображение</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{const file=e.target.files?.[0];if(file)void imageFileToDataUrl(file).then(v=>setEdit({...edit,imageSrc:v})).catch(()=>undefined)}}/></label><Field label="Категория" value={edit.category} onChange={v=>setEdit({...edit,category:v})}/>
      <label className="field"><span>Тип награды</span><select value={edit.rewardType} onChange={e=>setEdit({...edit,rewardType:e.target.value})}>{['item','digital_reward','frame','bonus'].map(x=><option key={x} value={x}>{businessLabel(x)}</option>)}</select></label>
      <Field label="Цена, бонусов" type="number" value={Number(edit.bonusPrice||0)} onChange={v=>setEdit({...edit,bonusPrice:Number(v)})}/><Field label="Остаток" type="number" value={edit.stock??0} onChange={v=>setEdit({...edit,stock:Number(v)})}/>
      <Field label="Лимит на гостя (0 = без лимита)" type="number" value={edit.purchaseLimit??0} onChange={v=>setEdit({...edit,purchaseLimit:Number(v)||null})}/><div className="setting-row"><span>Активен</span><Toggle value={edit.enabled} onChange={v=>setEdit({...edit,enabled:v})}/></div>
    </EditorModal>}
  </div>
}

interface PromoItem {code:string;title:string;description:string;image_src?:string|null;imageSrc?:string|null;starts_at?:string|null;startsAt?:string|null;ends_at?:string|null;endsAt?:string|null;mechanic:Record<string,unknown>;reward:Record<string,unknown>;multiplier:number|null;enabled:boolean;sort_order?:number;sortOrder?:number;state?:string}
export function PromotionManager({venue,session}:{venue:ApiVenue;session:AdminSession}){
  const path=`/api/admin/venues/${venue.id}/promotions/manage`,{data,error,loading,reload,setData}=useResource<{source:string;items:PromoItem[]}>(path)
  const [items,setItems]=useState<PromoItem[]>([]),[edit,setEdit]=useState<PromoItem|null>(null),[save,setSave]=useState(initialSave)
  useEffect(()=>{if(data)setItems(data.items.map((x,i)=>({...x,imageSrc:x.imageSrc??x.image_src??null,startsAt:x.startsAt??x.starts_at??null,endsAt:x.endsAt??x.ends_at??null,sortOrder:x.sortOrder??x.sort_order??i})))},[data])
  async function persist(){setSave({busy:true,error:'',ok:''});try{const saved=await apiPut<any>(path,{items});setData(saved);setSave({busy:false,error:'',ok:'Акции сохранены; статус обновлён автоматически.'})}catch(e){setSave({busy:false,error:e instanceof Error?e.message:'Не удалось сохранить.',ok:''})}}
  if(loading&&!data)return <LoadingCard/>;if(error&&!data)return <ErrorCard error={error} onRetry={reload}/>
  return <div className="page"><PageHead eyebrow="МАРКЕТИНГОВЫЕ КАМПАНИИ" title="Акции" sub={`${venue.companyName} → ${venue.name}`}
    actions={<><WriteGatePill enabled={session.capabilities.writes}/><button className="btn" disabled={!session.capabilities.writes||save.busy} onClick={()=>void persist()}><Save/>Сохранить</button><button className="btn secondary" onClick={()=>setEdit({code:newCode('promo'),title:'',description:'',startsAt:null,endsAt:null,mechanic:{type:'cashback'},reward:{},multiplier:null,enabled:false,sortOrder:items.length})}><Plus/>Акция</button></>}/>
    <div className="promo-grid">{items.map((x,i)=><article className="promo-card card" key={x.code}><div className={cn('promo-visual',`promo-${i%3}`)}><TicketPercent/><span>{businessLabel(x.state||'DRAFT')}</span></div><div className="promo-body">
      <div><Status value={businessLabel(x.state||'DRAFT')}/><button className="ghost-icon" onClick={()=>setEdit({...x})}><Pencil/></button></div><h3>{x.title}</h3><p>{x.description}</p><strong>{x.multiplier?`×${x.multiplier}`:rewardSummary(x.reward)}</strong><div className="promo-metrics"><span>{x.startsAt?new Date(x.startsAt).toLocaleString('ru-RU'):'без старта'}</span><span>{x.endsAt?new Date(x.endsAt).toLocaleString('ru-RU'):'без конца'}</span></div>
    </div></article>)}</div><SaveMessage state={save}/><SourceNote>Статус акции рассчитывается автоматически по датам начала и окончания.</SourceNote>
    {edit&&<EditorModal title="Редактор акции" onCancel={()=>setEdit(null)} onSave={()=>{const next=items.some(x=>x.code===edit.code)?items.map(x=>x.code===edit.code?edit:x):[...items,edit];setItems(next);setEdit(null)}}>
      <Field label="Код" value={edit.code} onChange={v=>setEdit({...edit,code:v})}/><Field label="Название" value={edit.title} onChange={v=>setEdit({...edit,title:v})}/><Field label="Описание" value={edit.description} onChange={v=>setEdit({...edit,description:v})}/><Field label="Ссылка на изображение" value={edit.imageSrc||''} onChange={v=>setEdit({...edit,imageSrc:v||null})}/><label className="field upload-field"><span>Или загрузить изображение</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{const file=e.target.files?.[0];if(file)void imageFileToDataUrl(file).then(v=>setEdit({...edit,imageSrc:v})).catch(()=>undefined)}}/></label>
      <Field label="Дата начала" value={edit.startsAt||''} onChange={v=>setEdit({...edit,startsAt:v||null})}/><Field label="Дата окончания" value={edit.endsAt||''} onChange={v=>setEdit({...edit,endsAt:v||null})}/>
      <Field label="Тип механики" value={String((edit.mechanic as any)?.type||'cashback')} onChange={v=>setEdit({...edit,mechanic:{...edit.mechanic,type:v}})}/><Field label="Множитель" type="number" value={edit.multiplier??0} onChange={v=>setEdit({...edit,multiplier:Number(v)||null})}/>
      <div className="setting-row"><span>Активна</span><Toggle value={edit.enabled} onChange={v=>setEdit({...edit,enabled:v})}/></div>
    </EditorModal>}
  </div>
}

interface BrandingData {source:string;brandingEnabled:boolean|null;branding:Record<string,unknown>;phone:string|null;links:Record<string,unknown>;venue:{name:string;address:string|null}}
export function BrandingManager({venue,session}:{venue:ApiVenue;session:AdminSession}){
  const path=`/api/admin/venues/${venue.id}/branding/manage`,{data,error,loading,reload,setData}=useResource<BrandingData>(path)
  const [draft,setDraft]=useState<BrandingData|null>(null),[save,setSave]=useState(initialSave)
  useEffect(()=>{if(data)setDraft(structuredClone(data))},[data])
  if(loading&&!draft)return <LoadingCard/>;if(error&&!draft)return <ErrorCard error={error} onRetry={reload}/>;if(!draft)return null
  const primary=String(draft.branding.primaryAccent||'#B9FF66'),secondary=String(draft.branding.secondaryAccent||'#22262B')
  const persist=async()=>{const current=draft;setSave({busy:true,error:'',ok:''});try{const saved=await apiPut<BrandingData>(path,{brandingEnabled:current.brandingEnabled===true,branding:current.branding,phone:current.phone,links:current.links,venueName:current.venue.name,address:current.venue.address});setData(saved);setDraft(structuredClone(saved));setSave({busy:false,error:'',ok:'Оформление сохранено.'})}catch(e){setSave({busy:false,error:e instanceof Error?e.message:'Не удалось сохранить.',ok:''})}}
  return <div className="page"><PageHead eyebrow="ФИРМЕННЫЙ СТИЛЬ" title="Оформление" sub={`${venue.companyName} → ${venue.name}`}
    actions={<><WriteGatePill enabled={session.capabilities.writes}/><button className="btn" disabled={!session.capabilities.writes||save.busy} onClick={()=>void persist()}><Save/>Сохранить</button></>}/>
    <div className="brand-layout"><section className="card editor-card brand-form"><CardTitle title="Идентика"/>
      <div className="setting-row"><div><b>Фирменный стиль включён</b><span>Управляет оформлением клиентского интерфейса</span></div><Toggle value={draft.brandingEnabled===true} onChange={v=>setDraft({...draft,brandingEnabled:v})}/></div>
      <Field label="Название заведения" value={draft.venue.name} onChange={v=>setDraft({...draft,venue:{...draft.venue,name:v}})}/><Field label="Адрес" value={draft.venue.address||''} onChange={v=>setDraft({...draft,venue:{...draft.venue,address:v||null}})}/>
      <Field label="Ссылка на логотип" value={String(draft.branding.logo||'')} onChange={v=>setDraft({...draft,branding:{...draft.branding,logo:v}})}/><Field label="Ссылка на обложку" value={String(draft.branding.cover||'')} onChange={v=>setDraft({...draft,branding:{...draft.branding,cover:v}})}/>
      <div className="form-grid two">
        <label className="field upload-field"><span>Загрузить логотип</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{const file=e.target.files?.[0];if(file)void imageFileToDataUrl(file).then(v=>setDraft({...draft,branding:{...draft.branding,logo:v}})).catch(()=>undefined)}}/></label>
        <label className="field upload-field"><span>Загрузить обложку</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{const file=e.target.files?.[0];if(file)void imageFileToDataUrl(file).then(v=>setDraft({...draft,branding:{...draft.branding,cover:v}})).catch(()=>undefined)}}/></label>
      </div>
      <label className="field"><span>Основной цвет</span><div className="color-input"><input type="color" value={primary} onChange={e=>setDraft({...draft,branding:{...draft.branding,primaryAccent:e.target.value}})}/><input value={primary} onChange={e=>setDraft({...draft,branding:{...draft.branding,primaryAccent:e.target.value}})}/></div></label>
      <label className="field"><span>Дополнительный цвет</span><div className="color-input"><input type="color" value={secondary} onChange={e=>setDraft({...draft,branding:{...draft.branding,secondaryAccent:e.target.value}})}/><input value={secondary} onChange={e=>setDraft({...draft,branding:{...draft.branding,secondaryAccent:e.target.value}})}/></div></label>
      <label className="field"><span>Тема оформления</span><select value={String(draft.branding.theme||'premium-dark')} onChange={e=>setDraft({...draft,branding:{...draft.branding,theme:e.target.value}})}><option value="premium-dark">Тёмная премиальная</option><option value="dark">Тёмная</option><option value="light">Светлая</option></select></label><Field label="Телефон" value={draft.phone||''} onChange={v=>setDraft({...draft,phone:v})}/>
      <SaveMessage state={save}/><SourceNote>Сохранённые изменения применяются только после отдельного подтверждения запуска.</SourceNote>
    </section>
    <section className="card phone-preview-wrap"><span className="eyebrow">ПРЕДПРОСМОТР</span><div className="phone-preview" style={{'--preview-accent':primary,'--preview-secondary':secondary} as CSSProperties}>
      <div className="phone-status"><span>21:41</span><span>ПРИМЕР</span></div><div className="customer-cover"><div className="preview-logo">{venue.name.slice(0,1)}</div><span>ПРОГРАММА ЛОЯЛЬНОСТИ</span><h2>{draft.venue.name}</h2><p>{draft.venue.address}</p></div>
      <div className="balance-card"><span>Ваш баланс</span><b>2 840 <small>бонусов</small></b><div><span>Уровень</span><span>Кешбэк</span></div></div><div className="preview-actions"><span><Gift/>Колесо</span><span><ShoppingBag/>Магазин</span><span><Trophy/>Награды</span></div>
    </div><small className="preview-caption">Предпросмотр не изменяет интерфейс гостей.</small></section></div>
  </div>
}

export function FeatureFlagsManager({venue,session}:{venue:ApiVenue;session:AdminSession}){
  const {data,error,loading,reload,setData}=useResource<Record<string,boolean|null|string>>(`/api/admin/venues/${venue.id}/features/manage`)
  const [flags,setFlags]=useState<Record<string,boolean|null>>({wheelEnabled:null,shopEnabled:null,achievementsEnabled:null,referralsEnabled:null,promotionsEnabled:null,brandingEnabled:null})
  const [save,setSave]=useState(initialSave)
  useEffect(()=>{if(data)setFlags({
    wheelEnabled:data.wheelEnabled as boolean|null,shopEnabled:data.shopEnabled as boolean|null,
    achievementsEnabled:data.achievementsEnabled as boolean|null,referralsEnabled:data.referralsEnabled as boolean|null,
    promotionsEnabled:data.promotionsEnabled as boolean|null,brandingEnabled:data.brandingEnabled as boolean|null,
  })},[data])
  if(loading&&!data)return <LoadingCard/>;if(error&&!data)return <ErrorCard error={error} onRetry={reload}/>
  async function persist(){setSave({busy:true,error:'',ok:''});try{await apiPut(`/api/admin/venues/${venue.id}/features/manage`,flags);setData({...flags,fallback:'Текущие настройки сохраняются'});setSave({busy:false,error:'',ok:'Настройки доступности сохранены.'})}catch(e){setSave({busy:false,error:e instanceof Error?e.message:'Не удалось сохранить.',ok:''})}}
  return <div className="page"><PageHead eyebrow="УПРАВЛЕНИЕ СЕРВИСАМИ" title="Настройки" sub={`${venue.companyName} → ${venue.name}`} actions={<><WriteGatePill enabled={session.capabilities.writes}/><button className="btn" disabled={!session.capabilities.writes} onClick={()=>void persist()}><Save/>Сохранить</button></>}/>
    <div className="settings-grid"><section className="card editor-card"><CardTitle title="Доступность разделов"/>
      {[
        ['wheelEnabled','Колесо'],['shopEnabled','Магазин'],['achievementsEnabled','Достижения'],['referralsEnabled','Рефералы'],['promotionsEnabled','Акции'],['brandingEnabled','Оформление'],
      ].map(([key,label])=><div className="setting-row" key={key}><div><b>{label}</b><span>{flags[key]===null?'ТЕКУЩИЙ РЕЖИМ':flags[key]?'ВКЛЮЧЕНО':'ВЫКЛЮЧЕНО'}</span></div>
        <div className="tri-state"><button className={flags[key]===null?'active':''} onClick={()=>setFlags({...flags,[key]:null})}>Как сейчас</button><button className={flags[key]===true?'active':''} onClick={()=>setFlags({...flags,[key]:true})}>Вкл.</button><button className={flags[key]===false?'active danger':''} onClick={()=>setFlags({...flags,[key]:false})}>Выкл.</button></div>
      </div>)}<SaveMessage state={save}/><SourceNote>Режим «Как сейчас» сохраняет действующее поведение раздела без изменений.</SourceNote>
    </section>
    <section className="card editor-card"><CardTitle title="Состояние операций"/><>
      <div className="setting-row"><div><b>Изменение настроек</b><span>Управление заведением</span></div><strong className={session.capabilities.writes?'safe-word':'read-only-word'}>{session.capabilities.writes?'ДОСТУПНО':'ТОЛЬКО ЧТЕНИЕ'}</strong></div>
      <div className="setting-row"><div><b>Операции с бонусами</b><span>Изменение баланса гостей</span></div><strong className={session.capabilities.productionBonusWrites?'safe-word':'read-only-word'}>{session.capabilities.productionBonusWrites?'ДОСТУПНО':'НЕДОСТУПНО'}</strong></div>
      <div className="setting-row"><div><b>Клиентские приложения</b><span>Работают независимо от панели управления</span></div><strong className="safe-word">НЕЗАВИСИМЫ</strong></div>
    </></section></div>
  </div>
}
