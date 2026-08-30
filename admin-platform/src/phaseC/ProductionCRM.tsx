import { useEffect,useState } from 'react'
import {
  Coins,Database,Gift,MoreHorizontal,Search,ShieldCheck,
  SlidersHorizontal,Trophy,X,
} from 'lucide-react'
import type { AdminSession,ApiVenue } from '../api'
import { apiGet,apiPost,apiPut,makeIdempotencyKey } from '../api'
import {
  ConfirmModal,Detail,EditorModal,EmptyState,Field,LevelBadge,PageHead,PlatformTag,Status,rub,
} from '../ui'
import { ErrorCard,LivePill,LoadingCard,SourceNote,WriteGatePill,dt,useResource } from './common'
import { businessLabel } from './labels'

interface Client {
  id:string;name:string;username:string|null;registeredAt:string;membershipStatus:string;balance:number;
  lifetimeSpend:number;averageCheck:number|null;operationCount:number;lastActivityAt:string|null;
  bonusEarned:number;bonusRedeemed:number;platform:string;level:string;cashbackPercent:number;
  visitCount:null;visitCountReason:string
}
interface ListResponse {total:number;rows:Client[]}
interface DetailResponse extends Client {
  maxCheck:number|null;firstActivityAt:string|null;paidMlTotal:number;giftMlBalance:number;
  identities:Array<{provider:string;provider_user_id:string;provider_username:string|null}>
  timeline:Array<{id:string;mode:string;status:string;occurred_at:string;checkAmount:number;cashPaid:number;bonusEarned:number;bonusSpent:number;reason?:string|null}>
  achievements:Array<Record<string,unknown>>;wheelHistory:Array<Record<string,unknown>>;shopPurchases:Array<Record<string,unknown>>
}
interface AchievementConfigResponse {items:Array<{code:string;title:string}>}

export function ProductionCRM({venue,session}:{venue:ApiVenue;session:AdminSession}){
  const [query,setQuery]=useState(''),[sort,setSort]=useState('lastActivity'),[selected,setSelected]=useState<string|null>(null)
  const path=`/api/admin/venues/${venue.id}/clients?q=${encodeURIComponent(query)}&sort=${sort}&limit=100`
  const {data,error,loading,reload}=useResource<ListResponse>(path,[query,sort])
  return <div className="page">
    <PageHead eyebrow="БАЗА КЛИЕНТОВ" title="Клиенты" sub={data?`${rub.format(data.total)} клиентов в выбранном заведении`:'Загрузка клиентской базы'}
      actions={<><LivePill/><WriteGatePill enabled={session.capabilities.productionBonusWrites} label="БОНУСЫ"/></>}/>
    <div className="toolbar card">
      <label className="search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Имя, ник или ID клиента…"/></label>
      <div className="toolbar-filters"><select value={sort} onChange={e=>setSort(e.target.value)}>
        <option value="lastActivity">Последняя активность</option><option value="spend">Сумма покупок</option><option value="balance">Баланс</option><option value="created">Регистрация</option>
      </select><div className="live-source-pill"><span/><Database/>ДАННЫЕ ЗАВЕДЕНИЯ</div></div>
    </div>
    {error&&<ErrorCard error={error} onRetry={reload}/>}
    {loading&&!data&&<LoadingCard/>}
    {data&&<div className={loading?'table-card card loading-dim':'table-card card'}><div className="table-scroll"><table>
      <thead><tr><th>Клиент</th><th>Баланс</th><th>Кэшбэк</th><th>Уровень</th><th>Операции</th><th>Сумма покупок</th><th>Средний чек</th><th>Последняя активность</th><th>Канал</th><th>Статус</th><th/></tr></thead>
      <tbody>{data.rows.map(c=><tr key={c.id} onClick={()=>setSelected(c.id)}>
        <td><div className="person"><div className="avatar">{c.name.split(' ').map(x=>x[0]).slice(0,2).join('')}</div><div><b>{c.name||'Без имени'}</b><span>{c.username?`@${c.username}`:`ID ${c.id}`}</span></div></div></td>
        <td><strong>{rub.format(c.balance)}</strong></td><td>{c.cashbackPercent}%</td><td><LevelBadge level={c.level}/></td>
        <td>{rub.format(c.operationCount)}</td><td>₽ {rub.format(Math.round(c.lifetimeSpend))}</td><td>{c.averageCheck===null?'Нет данных':`₽ ${rub.format(Math.round(c.averageCheck))}`}</td>
        <td>{dt(c.lastActivityAt)}</td><td><PlatformTag value={c.platform}/></td><td><Status value={c.membershipStatus==='active'?'Активен':c.membershipStatus}/></td><td><MoreHorizontal size={17}/></td>
      </tr>)}</tbody>
    </table></div></div>}
    {data&&data.rows.length===0&&<EmptyState title="Клиенты не найдены" sub="Измените поисковый запрос."/>}
    {selected&&<CustomerDrawer venue={venue} session={session} userId={selected} onClose={()=>setSelected(null)} onChanged={reload}/>}
  </div>
}

function CustomerDrawer({venue,session,userId,onClose,onChanged}:{venue:ApiVenue;session:AdminSession;userId:string;onClose:()=>void;onChanged:()=>void}){
  const [client,setClient]=useState<DetailResponse|null>(null),[error,setError]=useState(''),[reload,setReload]=useState(0)
  const [bonusMode,setBonusMode]=useState<'credit'|'debit'|null>(null),[achievementOpen,setAchievementOpen]=useState(false),[cashbackOpen,setCashbackOpen]=useState(false),[entitlementOpen,setEntitlementOpen]=useState(false)
  useEffect(()=>{setError('');apiGet<DetailResponse>(`/api/admin/venues/${venue.id}/clients/${userId}`).then(setClient).catch(e=>setError(e instanceof Error?e.message:'Ошибка клиента'))},[venue.id,userId,reload])
  const refresh=()=>{setReload(v=>v+1);onChanged()}
  return <div className="drawer-layer">
    <button className="drawer-scrim" onClick={onClose} aria-label="Закрыть карточку"/>
    <aside className="drawer">
      <div className="drawer-head"><div><span className="eyebrow">КАРТОЧКА КЛИЕНТА</span><h2>{client?.name||'Загрузка…'}</h2><span className="drawer-sub">{venue.companyName} → {venue.name} · клиент #{userId}</span></div><button className="icon-btn" onClick={onClose}><X/></button></div>
      {error&&<div className="inline-warning">{error}</div>}
      {client&&<>
        <div className="drawer-actions">
          <button className="btn" disabled={!session.capabilities.productionBonusWrites} onClick={()=>setBonusMode('credit')}><Coins/>Начислить</button>
          <button className="btn secondary danger-outline" disabled={!session.capabilities.productionBonusWrites} onClick={()=>setBonusMode('debit')}><Coins/>Списать</button>
          <button className="btn secondary" disabled={!session.capabilities.productionAchievementWrites} onClick={()=>setAchievementOpen(true)}><Trophy/>Достижение</button>
          <button className="btn secondary" disabled={!session.capabilities.writes} onClick={()=>setEntitlementOpen(true)}><Gift/>Рамка / товар</button>
          <button className="btn secondary" disabled={!session.capabilities.writes} onClick={()=>setCashbackOpen(true)}><SlidersHorizontal/>Кешбэк</button>
        </div>
        {!session.capabilities.productionBonusWrites&&<SourceNote>Изменение бонусного баланса сейчас доступно только для просмотра.</SourceNote>}
        <div className="detail-grid">
          <Detail label="Баланс" value={rub.format(client.balance)}/><Detail label="Сумма покупок" value={`₽ ${rub.format(Math.round(client.lifetimeSpend))}`}/>
          <Detail label="Средний чек" value={client.averageCheck===null?'Нет данных':`₽ ${rub.format(Math.round(client.averageCheck))}`}/>
          <Detail label="Операций" value={String(client.operationCount)}/><Detail label="Начислено" value={rub.format(client.bonusEarned)}/><Detail label="Списано" value={rub.format(client.bonusRedeemed)}/>
        </div>
        <h3 className="section-title">Профили</h3>
        <div className="identity-list">{client.identities.map(i=><div key={`${i.provider}:${i.provider_user_id}`}><PlatformTag value={i.provider==='vk'?'VK':'TG'}/><b>{i.provider_username?`@${i.provider_username}`:i.provider_user_id}</b><span>{i.provider_user_id}</span></div>)}</div>
        <h3 className="section-title">Лояльность</h3>
        <div className="progress-card"><div><LevelBadge level={client.level}/><b>{client.cashbackPercent}% кэшбэк</b></div><span>Индивидуальные условия клиента сохраняются отдельно от общих настроек заведения.</span></div>
        <h3 className="section-title">История операций</h3>
        <div className="timeline">{client.timeline.map(x=><div className="timeline-row" key={x.id}><i/><div><span>{dt(x.occurred_at)}</span><b>{businessLabel(x.mode)} · {businessLabel(x.status)}</b><p>Чек ₽ {rub.format(Math.round(x.checkAmount||0))} · оплачено ₽ {rub.format(Math.round(x.cashPaid||0))} · +{x.bonusEarned||0} / −{x.bonusSpent||0} Б</p>{x.reason&&<p>{x.reason}</p>}</div></div>)}</div>
      </>}
    </aside>
    {bonusMode&&client&&<BonusModal venue={venue} client={client} mode={bonusMode} onCancel={()=>setBonusMode(null)} onSaved={()=>{setBonusMode(null);refresh()}}/>}
    {achievementOpen&&client&&<AchievementGrantModal venue={venue} client={client} onCancel={()=>setAchievementOpen(false)} onSaved={()=>{setAchievementOpen(false);refresh()}}/>}
    {cashbackOpen&&client&&<CashbackModal venue={venue} client={client} onCancel={()=>setCashbackOpen(false)} onSaved={()=>{setCashbackOpen(false);refresh()}}/>}
    {entitlementOpen&&client&&<EntitlementModal venue={venue} session={session} client={client} onCancel={()=>setEntitlementOpen(false)} onSaved={()=>{setEntitlementOpen(false);refresh()}}/>}
  </div>
}

function BonusModal({venue,client,mode,onCancel,onSaved}:{venue:ApiVenue;client:DetailResponse;mode:'credit'|'debit';onCancel:()=>void;onSaved:()=>void}){
  const [amount,setAmount]=useState(100),[reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false)
  const submit=async()=>{setBusy(true);setError('');try{
    await apiPost(`/api/admin/venues/${venue.id}/clients/${client.id}/bonus-adjustments`,{type:mode,amount,reason,idempotencyKey:makeIdempotencyKey(`bonus-${mode}`)})
    onSaved()
  }catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить изменение.')}finally{setBusy(false);setConfirm(false)}}
  return <>
    <div className="modal-layer"><button className="modal-scrim" onClick={onCancel}/><div className="modal editor-modal">
      <div className="modal-head"><div><span className="eyebrow">{mode==='credit'?'НАЧИСЛЕНИЕ БОНУСОВ':'СПИСАНИЕ БОНУСОВ'}</span><h2>{client.name}</h2></div><button className="icon-btn" onClick={onCancel}><X/></button></div>
      <div className="tenant-confirm-strip"><ShieldCheck/>{venue.companyName} → {venue.name} · клиент #{client.id}</div>
      <div className="modal-body"><Field label="Количество бонусов" type="number" value={amount} onChange={v=>setAmount(Number(v))}/><Field label="Причина / комментарий" value={reason} onChange={setReason}/>
        <div className="balance-preview"><span>Текущий баланс</span><b>{rub.format(client.balance)}</b><span>После операции</span><strong>{rub.format(mode==='credit'?client.balance+Math.max(0,amount):Math.max(0,client.balance-Math.max(0,amount)))}</strong></div>
        {error&&<div className="login-error">{error}</div>}
      </div>
      <div className="modal-actions"><button className="btn secondary" onClick={onCancel}>Отмена</button><button className="btn" disabled={busy||!Number.isSafeInteger(amount)||amount<=0||reason.trim().length<3} onClick={()=>mode==='debit'?setConfirm(true):void submit()}>{busy?'Сохраняем…':mode==='credit'?'Начислить':'Продолжить'}</button></div>
    </div></div>
    {confirm&&<ConfirmModal title={`Списать ${rub.format(amount)} бонусов?`} text={`Клиент: ${client.name}. Заведение: ${venue.companyName} → ${venue.name}. Операция появится в журнале действий.`} onCancel={()=>setConfirm(false)} onConfirm={()=>void submit()}/>}
  </>
}

function AchievementGrantModal({venue,client,onCancel,onSaved}:{venue:ApiVenue;client:DetailResponse;onCancel:()=>void;onSaved:()=>void}){
  const [configs,setConfigs]=useState<AchievementConfigResponse|null>(null),[selected,setSelected]=useState(''),[reason,setReason]=useState(''),[error,setError]=useState(''),[confirm,setConfirm]=useState(false)
  useEffect(()=>{apiGet<AchievementConfigResponse>(`/api/admin/venues/${venue.id}/achievements/manage`).then(v=>{setConfigs(v);setSelected(v.items[0]?.code||'')}).catch(e=>setError(e instanceof Error?e.message:'Ошибка списка'))},[venue.id])
  const submit=async()=>{try{await apiPost(`/api/admin/venues/${venue.id}/clients/${client.id}/achievements/grant`,{achievementCode:selected,reason,idempotencyKey:makeIdempotencyKey('achievement-grant')});onSaved()}catch(e){setError(e instanceof Error?e.message:'Не удалось выдать достижение.');setConfirm(false)}}
  return <>
    <div className="modal-layer"><button className="modal-scrim" onClick={onCancel}/><div className="modal editor-modal">
      <div className="modal-head"><div><span className="eyebrow">НАГРАДА КЛИЕНТУ</span><h2>Выдать достижение</h2></div><button className="icon-btn" onClick={onCancel}><X/></button></div>
      <div className="tenant-confirm-strip"><ShieldCheck/>{venue.companyName} → {venue.name} · {client.name}</div>
      <div className="modal-body"><label className="field"><span>Достижение</span><select value={selected} onChange={e=>setSelected(e.target.value)}>{configs?.items.map(x=><option key={x.code} value={x.code}>{x.title} · {x.code}</option>)}</select></label>
        <Field label="Причина" value={reason} onChange={setReason}/>{error&&<div className="login-error">{error}</div>}</div>
      <div className="modal-actions"><button className="btn secondary" onClick={onCancel}>Отмена</button><button className="btn" disabled={!selected||reason.trim().length<3} onClick={()=>setConfirm(true)}><Trophy/>Выдать</button></div>
    </div></div>
    {confirm&&<ConfirmModal title="Подтвердить выдачу?" text="Достижение и награда будут выданы один раз и появятся в журнале действий." onCancel={()=>setConfirm(false)} onConfirm={()=>void submit()}/>}
  </>
}

function CashbackModal({venue,client,onCancel,onSaved}:{venue:ApiVenue;client:DetailResponse;onCancel:()=>void;onSaved:()=>void}){
  const [value,setValue]=useState(client.cashbackPercent),[reason,setReason]=useState(''),[error,setError]=useState('')
  const submit=async()=>{try{await apiPut(`/api/admin/venues/${venue.id}/clients/${client.id}/cashback`,{cashbackPercent:value,reason,enabled:true});onSaved()}catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить.')}}
  return <EditorModal title="Индивидуальный кешбэк" onCancel={onCancel} onSave={()=>void submit()}>
    <div className="tenant-confirm-strip"><ShieldCheck/>{venue.companyName} → {venue.name} · {client.name}</div>
    <Field label="Кешбэк, %" type="number" value={value} onChange={v=>setValue(Number(v))}/><Field label="Причина" value={reason} onChange={setReason}/>
    <SourceNote>Индивидуальный кэшбэк сохранится только для выбранного клиента и заведения.</SourceNote>
    {error&&<div className="login-error">{error}</div>}
  </EditorModal>
}


function EntitlementModal({venue,session,client,onCancel,onSaved}:{venue:ApiVenue;session:AdminSession;client:DetailResponse;onCancel:()=>void;onSaved:()=>void}){
  const [type,setType]=useState<'frame'|'item'|'digital_reward'>('frame'),[code,setCode]=useState(''),[reason,setReason]=useState(''),[error,setError]=useState(''),[confirm,setConfirm]=useState(false)
  const runtimeActive=type==='frame'&&session.capabilities.productionEntitlementWrites
  async function submit(){
    try{
      await apiPost(`/api/admin/venues/${venue.id}/clients/${client.id}/entitlements`,{
        entitlementType:type,entitlementCode:code,reason,idempotencyKey:makeIdempotencyKey('entitlement'),
      })
      onSaved()
    }catch(e){setError(e instanceof Error?e.message:'Не удалось выдать награду.');setConfirm(false)}
  }
  return <>
    <div className="modal-layer"><button className="modal-scrim" onClick={onCancel}/><div className="modal editor-modal">
      <div className="modal-head"><div><span className="eyebrow">НАГРАДА КЛИЕНТУ</span><h2>Рамка, товар или цифровой подарок</h2></div><button className="icon-btn" onClick={onCancel}><X/></button></div>
      <div className="tenant-confirm-strip"><ShieldCheck/>{venue.companyName} → {venue.name} · {client.name}</div>
      <div className="modal-body">
        <label className="field"><span>Тип</span><select value={type} onChange={e=>setType(e.target.value as typeof type)}><option value="frame">Рамка</option><option value="item">Товар</option><option value="digital_reward">Цифровой подарок</option></select></label>
        <Field label="Код награды" value={code} onChange={setCode}/>
        <Field label="Причина" value={reason} onChange={setReason}/>
        <SourceNote>{runtimeActive?'Рамка будет сразу выдана клиенту и появится в журнале действий.':'Награда сохранится для выбранного клиента и заведения.'}</SourceNote>
        {error&&<div className="login-error">{error}</div>}
      </div>
      <div className="modal-actions"><button className="btn secondary" onClick={onCancel}>Отмена</button><button className="btn" disabled={code.trim().length<1||reason.trim().length<3} onClick={()=>setConfirm(true)}><Gift/>Выдать</button></div>
    </div></div>
    {confirm&&<ConfirmModal title="Подтвердить выдачу?" text={`${venue.companyName} → ${venue.name} → ${client.name}. ${runtimeActive?'Рамка станет доступна сразу.':'Награда будет сохранена.'}`} onCancel={()=>setConfirm(false)} onConfirm={()=>void submit()}/>}
  </>
}
