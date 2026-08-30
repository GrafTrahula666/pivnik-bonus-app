import { useMemo } from 'react'
import {
  ArrowUpRight,BarChart3,Coins,Database,ShieldCheck,Store,
} from 'lucide-react'
import type { ApiVenue } from '../api'
import type { Period } from './Layout'
import { CardTitle,PageHead,Status,rub } from '../ui'
import { ErrorCard,LivePill,LoadingCard,SourceNote,dt,useResource } from './common'

const days=(p:Period)=>p==='Сегодня'?1:p==='7 дней'?7:p==='30 дней'?30:p==='3 месяца'?90:365

export function ProductionOperations({venue}:{venue:ApiVenue}){
  const {data,error,loading,reload}=useResource<{rows:Array<any>}>(`/api/admin/venues/${venue.id}/operations?limit=150`)
  return <div className="page">
    <PageHead eyebrow="ИСТОРИЯ ОПЕРАЦИЙ" title="Операции" sub={`${venue.companyName} → ${venue.name}`} actions={<LivePill/>}/>
    {error&&<ErrorCard error={error} onRetry={reload}/>}
    {loading&&!data&&<LoadingCard/>}
    {data&&<>
      <div className="summary-strip card">
        <div><Database/><span>Строк</span><b>{data.rows.length}</b></div>
        <div><Coins/><span>Начислено</span><b>{rub.format(data.rows.reduce((s,r)=>s+Number(r.bonusEarned||0),0))}</b></div>
        <div><Coins/><span>Списано</span><b>{rub.format(data.rows.reduce((s,r)=>s+Number(r.bonusSpent||0),0))}</b></div>
        <div className={data.rows.some(r=>r.is_suspicious)?'warning':''}><ShieldCheck/><span>Требуют внимания</span><b>{data.rows.filter(r=>r.is_suspicious).length}</b></div>
      </div>
      <div className="table-card card"><div className="table-scroll"><table>
        <thead><tr><th>Дата</th><th>Клиент</th><th>Тип</th><th>Статус</th><th>Чек</th><th>Оплачено</th><th>Бонусы</th><th>Комментарий</th></tr></thead>
        <tbody>{data.rows.map(r=><tr key={r.id}><td>{dt(r.occurred_at)}</td><td><b>{[r.first_name,r.last_name].filter(Boolean).join(' ')}</b><br/><small>клиент #{r.user_id}</small></td>
          <td>{r.mode}</td><td><Status value={r.status==='completed'?'Успешно':r.status}/></td><td>₽ {rub.format(Math.round(r.checkAmount||0))}</td><td>₽ {rub.format(Math.round(r.cashPaid||0))}</td>
          <td>+{r.bonusEarned||0} / −{r.bonusSpent||0}</td><td>{r.reason||r.reward_code||'—'}</td></tr>)}</tbody>
      </table></div></div>
    </>}
  </div>
}

interface DashboardLike {
  metrics:Record<string,{value:number|null;available:boolean;reason?:string;source?:string}>
  unavailableMetrics:Array<{key:string;reason:string;requiredEvent:string}>
}
export function ProductionAnalytics({venue,period}:{venue:ApiVenue;period:Period}){
  const {data,error,loading,reload}=useResource<DashboardLike>(`/api/admin/venues/${venue.id}/dashboard?days=${days(period)}`)
  const facts=useMemo(()=>data?[
    ['Выручка',data.metrics.trackedRevenue,'money'],['Средний чек',data.metrics.averageCheck,'money'],
    ['Начислено бонусов',data.metrics.bonusEarned,'number'],['Списано бонусов',data.metrics.bonusRedeemed,'number'],
    ['Баланс бонусов',data.metrics.outstandingBonusBalance,'number'],['Доля списаний',data.metrics.redemptionRate,'percent'],
  ] as const:[],[data])
  const fmt=(m:any,k:string)=>!m.available||m.value===null?'Пока недостаточно данных':k==='money'?`₽ ${rub.format(Math.round(m.value))}`:k==='percent'?`${Number(m.value).toFixed(1)}%`:rub.format(Math.round(m.value))
  return <div className="page">
    <PageHead eyebrow="АНАЛИТИКА ЗАВЕДЕНИЯ" title="Аналитика" sub="Только достоверные показатели за выбранный период" actions={<LivePill/>}/>
    {error&&<ErrorCard error={error} onRetry={reload}/>}
    {loading&&!data&&<LoadingCard/>}
    {data&&<>
      <div className="analytics-grid">{facts.map(([label,m,k])=><div className="card mini-insight" key={label}><div><span>{label}</span><b>{fmt(m,k)}</b><small>{m.source||m.reason||'—'}</small></div><div className="mini-viz"><BarChart3/></div></div>)}</div>
      <section className="card editor-card"><CardTitle title="Недостающие события"/>
        <div className="metric-definition-list">{data.unavailableMetrics.map(x=><div key={x.key}><div><b>{x.key}</b><span>Пока недостаточно данных</span></div><p>{x.reason}</p><code>{x.requiredEvent}</code></div>)}</div>
      </section>
      <SourceNote>Сбор аналитики работает независимо и не мешает гостям пользоваться приложением.</SourceNote>
    </>}
  </div>
}

interface PlatformData {
  companies:Array<{company_id:string;company_code:string;company_name:string;venue_id:string|null;venue_code:string|null;venue_name:string|null;legacy_bar_id:string|null;customers:string}>
  metrics:Record<string,{value:null;reason:string}>
}
export function ProductionPlatform({mode,venues,onOpenVenue}:{mode:'platform'|'companies'|'venues';venues:ApiVenue[];onOpenVenue:(id:string)=>void}){
  const {data,error,loading,reload}=useResource<PlatformData>('/api/admin/platform')
  const grouped=useMemo(()=>{const map=new Map<string,{name:string;venues:any[];customers:number}>();for(const row of data?.companies||[]){const e=map.get(row.company_id)||{name:row.company_name,venues:[],customers:0};if(row.venue_id)e.venues.push(row);e.customers+=Number(row.customers||0);map.set(row.company_id,e)}return [...map.entries()]},[data])
  const title=mode==='platform'?'Платформа':mode==='companies'?'Компании':'Заведения'
  return <div className="page">
    <PageHead eyebrow="УПРАВЛЕНИЕ СЕТЬЮ" title={title} sub="Компании, заведения и ключевые показатели на одном экране" actions={<LivePill/>}/>
    {error&&<ErrorCard error={error} onRetry={reload}/>}
    {loading&&!data&&<LoadingCard/>}
    {data&&mode==='platform'&&<>
      <div className="platform-kpis">
        <div className="card platform-kpi"><span>Компании</span><b>{grouped.length}</b><strong>активно</strong></div>
        <div className="card platform-kpi"><span>Заведения</span><b>{venues.length}</b><strong>активно</strong></div>
        <div className="card platform-kpi"><span>Клиентов</span><b>{rub.format(grouped.reduce((s,[,v])=>s+v.customers,0))}</b><strong>в системе</strong></div>
        {['За день','За неделю','За месяц'].map(x=><div className="card platform-kpi unavailable-platform" key={x}><span>{x}</span><b>Нет данных</b><strong>история накапливается</strong></div>)}
      </div>
      <section className="card editor-card"><CardTitle title="Заведения платформы"/>
        {venues.map(v=><button className="platform-venue-row" key={v.id} onClick={()=>onOpenVenue(v.id)}><div><Store/><span><b>{v.name}</b><small>{v.companyName} · ID {v.id}</small></span></div><ArrowUpRight/></button>)}
      </section>
    </>}
    {data&&mode==='companies'&&<div className="table-card card"><div className="table-scroll"><table><thead><tr><th>Компания</th><th>Заведений</th><th>Клиентов</th><th>Источник</th></tr></thead><tbody>
      {grouped.map(([id,v])=><tr key={id}><td><b>{v.name}</b></td><td>{v.venues.length}</td><td>{rub.format(v.customers)}</td><td>Подключено</td></tr>)}
    </tbody></table></div></div>}
    {data&&mode==='venues'&&<div className="venue-grid">{venues.map(v=>{const row=data.companies.find(x=>x.venue_id===v.id);return <article className="card venue-card" key={v.id}>
      <div className="venue-thumb"><Store/></div><div><Status value="Активно"/><h3>{v.name}</h3><p>{v.address||'Адрес не задан'}</p><div className="venue-stats"><span><b>{rub.format(Number(row?.customers||0))}</b> клиентов</span><span><b>ID {v.id}</b> заведение</span></div>
      <button className="btn secondary" onClick={()=>onOpenVenue(v.id)}>Открыть заведение <ArrowUpRight/></button></div></article>})}</div>}
  </div>
}

export function ProductionAudit({venue,superAdmin}:{venue:ApiVenue;superAdmin:boolean}){
  const path=superAdmin?'/api/admin/audit?limit=180':`/api/admin/venues/${venue.id}/audit?limit=180`
  const {data,error,loading,reload}=useResource<{rows:Array<any>}>(path)
  return <div className="page">
    <PageHead eyebrow="ЖУРНАЛ ДЕЙСТВИЙ" title="Журнал" sub="Кто, что и когда изменил" actions={<LivePill/>}/>
    {error&&<ErrorCard error={error} onRetry={reload}/>}
    {loading&&!data&&<LoadingCard/>}
    {data&&<div className="table-card card"><div className="table-scroll"><table>
      <thead><tr><th>Дата</th><th>Администратор</th><th>Роль</th><th>Компания</th><th>Заведение</th><th>Действие</th><th>Объект</th><th>Причина</th><th>Было → Стало</th></tr></thead>
      <tbody>{data.rows.map(r=><tr key={r.id}><td>{dt(r.created_at)}</td><td><b>{r.admin_name||r.admin_email||'system'}</b></td><td>{r.admin_role||'—'}</td><td>{r.company_name||'—'}</td><td>{r.venue_name||'—'}</td>
        <td>{r.action}</td><td>{r.entity_type}{r.entity_id?` #${r.entity_id}`:''}</td><td>{r.reason||'—'}</td><td className="audit-json">{r.before_value?JSON.stringify(r.before_value):'—'} → {r.after_value?JSON.stringify(r.after_value):'—'}</td></tr>)}</tbody>
    </table></div></div>}
  </div>
}

export function ProductionCapabilities({venue}:{venue:ApiVenue}){
  const {data,error,loading,reload}=useResource<any>(`/api/admin/venues/${venue.id}/capabilities`)
  return <div className="page">
    <PageHead eyebrow="SYSTEM BOUNDARY" title="Настройки" sub={`${venue.companyName} → ${venue.name}`}/>
    {error&&<ErrorCard error={error} onRetry={reload}/>}
    {loading&&!data&&<LoadingCard/>}
    {data&&<div className="settings-grid">
      <section className="card editor-card"><CardTitle title="Production schema capabilities"/><div className="capability-grid">
        {Object.entries(data.productionSchema).map(([k,v])=><div key={k}><span className={v?'health-dot':'health-dot warm'}/><b>{k}</b><small>{v?'available':'missing'}</small></div>)}
      </div></section>
      <section className="card editor-card"><CardTitle title="Safety gates"/>
        <div className="setting-row"><div><b>Config writes</b><span>Admin-owned tables only</span></div><strong>{data.writeOperations.configWritesEnabled?'ON':'OFF'}</strong></div>
        <div className="setting-row"><div><b>Production bonus writes</b><span>least-privilege writer + explicit pilot env</span></div><strong className={data.writeOperations.productionBonusWritesEnabled?'safe-word':'read-only-word'}>{data.writeOperations.productionBonusWritesEnabled?'ON':'OFF'}</strong></div>
        <div className="setting-row"><div><b>Customer runtime dependency</b><span>VK/TG do not call Admin service</span></div><strong className="safe-word">NONE</strong></div>
      </section>
    </div>}
  </div>
}


export function CompanyVenuesOverview({venues,onOpenVenue}:{venues:ApiVenue[];onOpenVenue:(id:string)=>void}){
  const company=venues[0]?.companyName||'Компания'
  return <div className="page">
    <PageHead eyebrow="МОИ ЗАВЕДЕНИЯ" title={company} sub="Все доступные заведения компании"/>
    <div className="venue-grid">{venues.map(v=><article className="card venue-card" key={v.id}>
      <div className="venue-thumb"><Store/></div><div><Status value="Доступно"/><h3>{v.name}</h3><p>{v.address||'Адрес не задан'}</p>
        <div className="venue-stats"><span><b>{v.legacyBarId?'Подключено':'Готово'}</b> состояние</span><span><b>{v.code}</b> код заведения</span></div>
        <button className="btn secondary" onClick={()=>onOpenVenue(v.id)}>Открыть заведение <ArrowUpRight/></button>
      </div>
    </article>)}</div>
    <SourceNote>Общие показатели отображаются только там, где данные можно корректно объединить.</SourceNote>
  </div>
}
