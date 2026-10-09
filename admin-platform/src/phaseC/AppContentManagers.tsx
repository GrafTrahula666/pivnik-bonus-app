import { useEffect,useState,type CSSProperties } from 'react'
import { Eye,EyeOff,Pencil,Plus,Save,Smartphone,TicketPercent,Trash2 } from 'lucide-react'
import type { AdminSession,ApiVenue } from '../api'
import { apiDelete,apiPost,apiPut } from '../api'
import { CardTitle,ConfirmModal,EditorModal,Field,PageHead,Toggle,cn } from '../ui'
import { ErrorCard,LoadingCard,SourceNote,WriteGatePill,dt,imageFileToDataUrl,useResource } from './common'

// These editors change what guests see in the PIVNIK app: the same rows the app's own admin edits.

type SaveState={busy:boolean;error:string;ok:string}
const idle:SaveState={busy:false,error:'',ok:''}
const failed=(e:unknown)=>e instanceof Error?e.message:'Не удалось сохранить.'
function SaveMessage({state}:{state:SaveState}){
  if(state.error)return <div className="login-error">{state.error}</div>
  if(state.ok)return <div className="save-success">{state.ok}</div>
  return null
}
export function LinkedToAppNote(){return <div className="safety-note app-linked-note"><Smartphone/><span>Связано с приложением: изменения увидят все гости при следующем открытии приложения.</span></div>}

export const isPivnikAppVenue=(venue:ApiVenue)=>venue.companyCode==='pivnik'&&Boolean(venue.legacyBarId)

interface AppPromotion {id:string;code:string;title:string;description:string;badge:string;imageSrc:string;active:boolean;sortOrder:number;updatedAt:string|null}
interface PromotionDraft {id?:string;title:string;description:string;badge:string;active:boolean;sortOrder:number;imageSrc:string;imageChanged:boolean}

export function AppPromotionsManager({venue,session}:{venue:ApiVenue;session:AdminSession}){
  const base=`/api/admin/venues/${venue.id}/app/promotions`
  const {data,error,loading,reload,setData}=useResource<{items:AppPromotion[]}>(base)
  const [edit,setEdit]=useState<PromotionDraft|null>(null),[remove,setRemove]=useState<AppPromotion|null>(null),[save,setSave]=useState(idle)
  const canWrite=session.capabilities.writes
  if(loading&&!data)return <LoadingCard/>
  if(error&&!data)return <ErrorCard error={error} onRetry={reload}/>
  const items=data?.items||[]
  const put=(list:AppPromotion[])=>setData({items:[...list].sort((a,b)=>a.sortOrder-b.sortOrder||Number(a.id)-Number(b.id))})

  async function persist(){
    if(!edit)return
    const body:Record<string,unknown>={title:edit.title,description:edit.description,badge:edit.badge,active:edit.active,sortOrder:edit.sortOrder}
    if(edit.imageChanged)body.imageSrc=edit.imageSrc
    setSave({busy:true,error:'',ok:''})
    try{
      const saved=edit.id?await apiPut<AppPromotion>(`${base}/${edit.id}`,body):await apiPost<AppPromotion>(base,body)
      put(edit.id?items.map(x=>x.id===saved.id?saved:x):[...items,saved])
      setEdit(null);setSave({busy:false,error:'',ok:`Акция «${saved.title}» ${edit.id?'обновлена':'добавлена'} в приложении.`})
    }catch(e){setSave({busy:false,error:failed(e),ok:''})}
  }
  async function toggle(item:AppPromotion){
    setSave({busy:true,error:'',ok:''})
    try{
      const saved=await apiPut<AppPromotion>(`${base}/${item.id}`,{title:item.title,description:item.description,badge:item.badge,sortOrder:item.sortOrder,active:!item.active})
      put(items.map(x=>x.id===saved.id?saved:x));setSave({busy:false,error:'',ok:saved.active?'Акция показана гостям.':'Акция скрыта от гостей.'})
    }catch(e){setSave({busy:false,error:failed(e),ok:''})}
  }
  async function destroy(item:AppPromotion){
    setRemove(null);setSave({busy:true,error:'',ok:''})
    try{await apiDelete(`${base}/${item.id}`);put(items.filter(x=>x.id!==item.id));setSave({busy:false,error:'',ok:'Акция удалена из приложения.'})}
    catch(e){setSave({busy:false,error:failed(e),ok:''})}
  }
  const blank:PromotionDraft={title:'',description:'',badge:'',active:true,sortOrder:(items.at(-1)?.sortOrder||0)+10,imageSrc:'',imageChanged:false}

  return <div className="page">
    <PageHead eyebrow="ПРИЛОЖЕНИЕ ПИВНИК" title="Акции" sub={`${venue.companyName} → ${venue.name}`}
      actions={<><WriteGatePill enabled={canWrite}/><button className="btn" disabled={!canWrite||save.busy} onClick={()=>{setSave(idle);setEdit(blank)}}><Plus/>Акция</button></>}/>
    <LinkedToAppNote/>
    <SaveMessage state={save}/>
    <div className="promo-grid">{!items.length&&<div className="empty card"><TicketPercent/><h3>Акций пока нет</h3><p>Добавьте первую: она появится на главном экране приложения.</p></div>}{items.map((x,i)=><article className={cn('promo-card card',!x.active&&'promo-hidden')} key={x.id}>
      <div className={cn('promo-visual',`promo-${i%3}`)} style={x.imageSrc?{backgroundImage:`url("${x.imageSrc.replace(/"/g,'%22')}")`,backgroundSize:'cover',backgroundPosition:'center'}:undefined}>
        {!x.imageSrc&&<TicketPercent/>}{x.badge&&<span>{x.badge}</span>}
      </div>
      <div className="promo-body">
        <div><span className={x.active?'safe-word':'read-only-word'}>{x.active?'ВИДНА ГОСТЯМ':'СКРЫТА'}</span>
          <span className="promo-actions">
            <button className="ghost-icon" title={x.active?'Скрыть':'Показать'} disabled={!canWrite||save.busy} onClick={()=>void toggle(x)}>{x.active?<EyeOff/>:<Eye/>}</button>
            <button className="ghost-icon" title="Изменить" disabled={!canWrite} onClick={()=>{setSave(idle);setEdit({id:x.id,title:x.title,description:x.description,badge:x.badge,active:x.active,sortOrder:x.sortOrder,imageSrc:x.imageSrc,imageChanged:false})}}><Pencil/></button>
            <button className="ghost-icon" title="Удалить" disabled={!canWrite||save.busy} onClick={()=>setRemove(x)}><Trash2/></button>
          </span>
        </div>
        <h3>{x.title}</h3><p>{x.description}</p>
        <div className="promo-metrics"><span>Порядок: {x.sortOrder}</span><span>Изменена: {dt(x.updatedAt)}</span></div>
      </div>
    </article>)}</div>
    <SourceNote>Гости видят только акции с пометкой «Видна гостям», в порядке возрастания номера. Любое изменение записывается в журнал действий.</SourceNote>
    {edit&&<EditorModal title={edit.id?'Изменить акцию':'Новая акция'} onCancel={()=>setEdit(null)} onSave={()=>void persist()}>
      <Field label="Название" value={edit.title} onChange={v=>setEdit({...edit,title:v})}/>
      <label className="field"><span>Описание</span><textarea rows={3} maxLength={500} value={edit.description} onChange={e=>setEdit({...edit,description:e.target.value})}/></label>
      <Field label="Плашка (например, «−20%» или «Пт-Сб»)" value={edit.badge} onChange={v=>setEdit({...edit,badge:v})}/>
      <Field label="Ссылка на картинку (https://…)" value={edit.imageSrc.startsWith('data:')?'':edit.imageSrc} onChange={v=>setEdit({...edit,imageSrc:v,imageChanged:true})}/>
      <label className="field upload-field"><span>{edit.imageSrc.startsWith('data:')?'Загружена картинка. Заменить':'Или загрузить картинку'}</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{const file=e.target.files?.[0];if(file)void imageFileToDataUrl(file).then(v=>setEdit(cur=>cur&&{...cur,imageSrc:v,imageChanged:true})).catch(err=>setSave({busy:false,error:failed(err),ok:''}))}}/></label>
      {edit.imageSrc&&<button type="button" className="btn secondary" onClick={()=>setEdit({...edit,imageSrc:'',imageChanged:true})}><Trash2/>Убрать картинку</button>}
      <Field label="Порядок (меньше — выше)" type="number" value={edit.sortOrder} onChange={v=>setEdit({...edit,sortOrder:Number(v)||0})}/>
      <div className="setting-row"><span>Видна гостям</span><Toggle value={edit.active} onChange={v=>setEdit({...edit,active:v})}/></div>
      <SaveMessage state={save}/>
    </EditorModal>}
    {remove&&<ConfirmModal title="Удалить акцию?" text={`«${remove.title}» пропадёт из приложения у всех гостей. Если нужно просто убрать на время, лучше скрыть её.`} onCancel={()=>setRemove(null)} onConfirm={()=>void destroy(remove)}/>}
  </div>
}

type TextKey='brand'|'balanceLabel'|'byline'|'qrButton'
type SectionKey='promos'|'team'|'byline'
interface AppDesign {texts:Record<TextKey,string>;sections:Record<SectionKey,boolean>;radius:number;theme:'default'|'halloween'}
interface DesignResponse {design:AppDesign;draftPending:boolean;updatedAt:string|null}
const TEXTS:Array<[TextKey,string]>=[['brand','Название в шапке'],['balanceLabel','Подпись над балансом'],['qrButton','Кнопка QR-кода'],['byline','Подпись внизу']]
const SECTIONS:Array<[SectionKey,string,string]>=[['promos','Акции','Карусель акций на главном экране'],['team','Сотрудники','Блок с командой бара'],['byline','Подпись внизу','Строка с подписью автора']]

export function AppDesignManager({venue,session}:{venue:ApiVenue;session:AdminSession}){
  const path=`/api/admin/venues/${venue.id}/app/design`
  const {data,error,loading,reload,setData}=useResource<DesignResponse>(path)
  const [draft,setDraft]=useState<AppDesign|null>(null),[confirm,setConfirm]=useState(false),[save,setSave]=useState(idle)
  useEffect(()=>{if(data)setDraft(structuredClone(data.design))},[data])
  if(loading&&!draft)return <LoadingCard/>
  if(error&&!draft)return <ErrorCard error={error} onRetry={reload}/>
  if(!draft||!data)return null
  const canWrite=session.capabilities.writes
  const changed=JSON.stringify(draft)!==JSON.stringify(data.design)
  async function publish(){
    if(!draft)return
    setConfirm(false);setSave({busy:true,error:'',ok:''})
    try{const saved=await apiPut<{design:AppDesign}>(path,draft);setData({design:saved.design,draftPending:false,updatedAt:new Date().toISOString()});setSave({busy:false,error:'',ok:'Опубликовано: гости увидят изменения при следующем открытии приложения.'})}
    catch(e){setSave({busy:false,error:failed(e),ok:''})}
  }
  const night=draft.theme==='halloween'
  return <div className="page">
    <PageHead eyebrow="ПРИЛОЖЕНИЕ ПИВНИК" title="Оформление" sub={`${venue.companyName} → ${venue.name}`}
      actions={<><WriteGatePill enabled={canWrite}/><button className="btn" disabled={!canWrite||!changed||save.busy} onClick={()=>setConfirm(true)}><Save/>Опубликовать</button></>}/>
    <LinkedToAppNote/>
    <div className="brand-layout"><section className="card editor-card brand-form">
      <CardTitle title="Тексты"/>
      {TEXTS.map(([key,label])=><Field key={key} label={label} value={draft.texts[key]} onChange={v=>setDraft({...draft,texts:{...draft.texts,[key]:v}})}/>)}
      <CardTitle title="Блоки главного экрана"/>
      {SECTIONS.map(([key,label,hint])=><div className="setting-row" key={key}><div><b>{label}</b><span>{hint}</span></div><Toggle value={draft.sections[key]} onChange={v=>setDraft({...draft,sections:{...draft.sections,[key]:v}})}/></div>)}
      <CardTitle title="Вид"/>
      <label className="field"><span>Скругление карточек: {draft.radius} px</span><input type="range" min={8} max={36} value={draft.radius} onChange={e=>setDraft({...draft,radius:Number(e.target.value)})}/></label>
      <label className="field"><span>Тема</span><select value={draft.theme} onChange={e=>setDraft({...draft,theme:e.target.value==='halloween'?'halloween':'default'})}><option value="default">Обычная (светлая)</option><option value="halloween">Хэллоуин (ночная)</option></select></label>
      <SaveMessage state={save}/>
      <SourceNote>Последняя публикация: {dt(data.updatedAt)}.{data.draftPending?' В админке приложения есть неопубликованный черновик: его остальные правки сохранятся.':''}</SourceNote>
    </section>
    <section className="card phone-preview-wrap"><span className="eyebrow">ПРЕДПРОСМОТР</span>
      <div className={cn('phone-preview app-preview',night&&'app-preview-night')} style={{'--preview-radius':`${draft.radius}px`} as CSSProperties}>
        <div className="phone-status"><span>21:41</span><span>ПРИМЕР</span></div>
        <div className="app-preview-head"><b>{draft.texts.brand||'Пивник'}</b></div>
        <div className="balance-card"><span>{draft.texts.balanceLabel||'Ваш баланс'}</span><b>2 840 <small>бонусов</small></b><div><span className="app-preview-qr">{draft.texts.qrButton||'Показать QR'}</span></div></div>
        {draft.sections.promos&&<div className="app-preview-block"><TicketPercent/>Акции</div>}
        {draft.sections.team&&<div className="app-preview-block">Сотрудники</div>}
        {draft.sections.byline&&<small className="app-preview-byline">{draft.texts.byline} △</small>}
      </div><small className="preview-caption">Примерный вид. Цвета приложения фиксированы.</small></section></div>
    {confirm&&<ConfirmModal title="Опубликовать оформление?" text="Изменения сразу применятся в приложении у всех гостей." onCancel={()=>setConfirm(false)} onConfirm={()=>void publish()}/>}
  </div>
}
