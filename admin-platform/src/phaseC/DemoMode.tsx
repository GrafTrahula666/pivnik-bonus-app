import { useState } from 'react'
import type { Page } from '../appTypes'
import { auditSeed } from '../demoData'
import type { AuditEvent,Session } from '../domain'
import type { Period } from './Layout'
import { VenueOverview,OperationsPage,AnalyticsPage } from '../pages/Dashboard'
import { ClientsPage } from '../pages/CRM'
import { LoyaltyPage,WheelPage } from '../pages/LoyaltyWheel'
import { AchievementsPage } from '../pages/Achievements'
import { PromotionsPage,ShopPage } from '../pages/Commerce'
import { BrandPage,SettingsPage } from '../pages/BrandSettings'
import { AuditPage,CompaniesPage,PlatformPage,VenuesPage } from '../pages/SuperAudit'

const demoSession:Session={id:'sales-demo',name:'Демонстрация',role:'SUPER_ADMIN',companyIds:[]}

export function DemoMode({page,period,compare,onPage}:{page:Page;period:Period;compare:boolean;onPage:(p:Page)=>void}){
  const [audit,setAudit]=useState<AuditEvent[]>(auditSeed)
  const [flash,setFlash]=useState('')
  const notify=(text:string)=>{setFlash(text);window.setTimeout(()=>setFlash(''),1800)}
  const onAudit=(entity:string,summary:string)=>setAudit(events=>[{
    id:crypto.randomUUID(),admin:'Демонстрация',companyId:'c-pivnik',venueId:'v-pivnik-center',
    action:'Изменено',entity,summary,timestamp:'ДЕМО · сейчас',
  },...events])

  return <div className="demo-mode-surface">
    <div className="demo-watermark">ДЕМО-РЕЖИМ · ПРИМЕР ДАННЫХ · ИЗМЕНЕНИЯ НЕ СОХРАНЯЮТСЯ</div>
    {page==='overview'&&<VenueOverview venueName="ДЕМО · Флагманское заведение" period={period} compare={compare} onNavigate={onPage}/>}
    {page==='clients'&&<ClientsPage session={demoSession} venueId="v-pivnik-center" onAudit={onAudit} flash={notify}/>}
    {page==='operations'&&<OperationsPage venueId="v-pivnik-center"/>}
    {page==='analytics'&&<AnalyticsPage/>}
    {page==='loyalty'&&<LoyaltyPage onAudit={onAudit} flash={notify}/>}
    {page==='wheel'&&<WheelPage onAudit={onAudit} flash={notify}/>}
    {page==='achievements'&&<AchievementsPage onAudit={onAudit} flash={notify}/>}
    {page==='shop'&&<ShopPage onAudit={onAudit} flash={notify}/>}
    {page==='promotions'&&<PromotionsPage onAudit={onAudit} flash={notify}/>}
    {page==='brand'&&<BrandPage venueName="ДЕМО · Флагманское заведение" onAudit={onAudit} flash={notify}/>}
    {page==='settings'&&<SettingsPage venueName="ДЕМО · Флагманское заведение" flash={notify}/>}
    {page==='audit'&&<AuditPage session={demoSession} events={audit}/>}
    {page==='platform'&&<PlatformPage onOpenVenue={()=>onPage('overview')}/>}
    {page==='companies'&&<CompaniesPage onOpenVenue={()=>onPage('overview')}/>}
    {page==='venues'&&<VenuesPage onOpenVenue={()=>onPage('overview')}/>}
    {flash&&<div className="toast">{flash} · демонстрация</div>}
  </div>
}
