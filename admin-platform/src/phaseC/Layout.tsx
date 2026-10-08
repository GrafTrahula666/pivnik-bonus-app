import {
  Activity,BarChart3,Bell,Building2,CalendarDays,ChevronDown,ClipboardList,Crown,
  Database,Gift,LayoutDashboard,LogOut,Menu,Palette,Settings,ShieldCheck,
  ShoppingBag,Sparkles,Store,TicketPercent,Trophy,Users,WalletCards,
} from 'lucide-react'
import type { Page } from '../appTypes'
import type { AdminRole,ApiVenue } from '../api'
import { cn } from '../ui'

const nav=[
  ['overview','Обзор',LayoutDashboard],['clients','Клиенты',Users],['operations','Операции',WalletCards],
  ['analytics','Аналитика',BarChart3],['loyalty','Лояльность',Crown],['wheel','Колесо',Gift],
  ['achievements','Достижения',Trophy],['shop','Магазин',ShoppingBag],['promotions','Акции',TicketPercent],
  ['brand','Оформление',Palette],['settings','Настройки',Settings],['audit','Журнал',ClipboardList],
] as const
const superNav=[['platform','Платформа',Activity],['companies','Компании',Building2],['venues','Заведения',Store]] as const
export const periods=['Сегодня','7 дней','30 дней','3 месяца','Год'] as const
export type Period=(typeof periods)[number]
export type AppMode='production'|'demo'

export function PhaseCSidebar({page,role,mode,open,onClose,onPage}:{page:Page;role:AdminRole;mode:AppMode;open:boolean;onClose:()=>void;onPage:(page:Page)=>void}){
  return <>
    {open&&<button className="scrim" onClick={onClose} aria-label="Закрыть меню"/>}
    <aside className={cn('sidebar',open&&'open')}>
      <div className="brand"><div className="brand-mark">P</div><div><b>PIVNIK</b><span>BUSINESS</span></div></div>
      <div className={cn('demo-badge',mode==='production'&&'live-badge')}>
        {mode==='demo'?<Sparkles size={13}/>:<Database size={13}/>}
        {mode==='demo'?'ДЕМО-РЕЖИМ':'СИСТЕМА ПОДКЛЮЧЕНА'}
      </div>
      <nav className="nav">
        {nav.map(([id,label,Icon])=><button key={id} className={cn('nav-item',page===id&&'active')} onClick={()=>onPage(id)}>
          <Icon size={17}/><span>{label}</span>
        </button>)}
        {role==='SUPER_ADMIN'&&<>
          <div className="nav-separator"><span>УПРАВЛЕНИЕ СЕТЬЮ</span></div>
          {superNav.map(([id,label,Icon])=><button key={id} className={cn('nav-item',page===id&&'active')} onClick={()=>onPage(id)}>
            <Icon size={17}/><span>{label}</span>
          </button>)}
        </>}
      </nav>
      <div className="sidebar-foot"><div className="system-ok"><span/><div>
        <b>{mode==='demo'?'Демонстрация':'Панель управления'}</b>
        <small>{mode==='demo'?'изменения не сохраняются':'приложения для гостей работают независимо'}</small>
      </div></div></div>
    </aside>
  </>
}

export function PhaseCTopbar({
  role,adminName,mode,venues,venueId,period,compare,onMenu,onVenue,onPeriod,onCompare,onMode,onLogout,
}:{
  role:AdminRole;adminName:string;mode:AppMode;venues:ApiVenue[];venueId:string;period:Period;compare:boolean;
  onMenu:()=>void;onVenue:(id:string)=>void;onPeriod:(p:Period)=>void;onCompare:(v:boolean)=>void;onMode:(m:AppMode)=>void;onLogout:()=>void
}){
  return <header className="topbar">
    <button className="icon-btn mobile-menu" onClick={onMenu}><Menu size={20}/></button>
    <div className="tenant-select-wrap">
      <select className="tenant-select" value={venueId} onChange={e=>onVenue(e.target.value)} disabled={mode==='demo'}>
        {mode==='demo'?<option value="demo-pivnik">ДЕМО · Заведение</option>:<>
          {role==='VENUE_ADMIN'&&venues.length>1&&<option value="__all__">ВСЕ ЗАВЕДЕНИЯ · {venues[0]?.companyName}</option>}
          {venues.map(v=><option key={v.id} value={v.id}>{v.companyName} · {v.name}</option>)}
        </>}
      </select><ChevronDown size={15}/>
    </div>
    <div className="topbar-grow"/>
    <div className="mode-switch segmented">
      <button className={mode==='production'?'active':''} onClick={()=>onMode('production')}><Database size={13}/>Рабочий режим</button>
      <button className={mode==='demo'?'active':''} onClick={()=>onMode('demo')}><Sparkles size={13}/>Демо</button>
    </div>
    <div className="periods desktop-only">
      {periods.map(p=><button key={p} className={period===p?'active':''} onClick={()=>onPeriod(p)}>{p}</button>)}
      <button disabled title="Выбор произвольного периода будет доступен позже"><CalendarDays size={14}/>Свой</button>
    </div>
    <label className="compare desktop-only"><input type="checkbox" checked={compare} onChange={e=>onCompare(e.target.checked)}/><span/>Сравнение</label>
    <button className="icon-btn" disabled title="Новых уведомлений нет"><Bell size={18}/></button>
    <div className="profile-menu">
      <button className="profile-button"><div className="avatar small">{adminName.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase()}</div><div><b>{adminName}</b><span>{role==='SUPER_ADMIN'?'Главный администратор':'Владелец'}</span></div><ChevronDown size={14}/></button>
      <div className="profile-popover"><button onClick={onLogout}><LogOut size={15}/>Выйти</button></div>
    </div>
  </header>
}

export function TenantDangerContext({role,mode,venue,onBack}:{role:AdminRole;mode:AppMode;venue:ApiVenue|null;onBack:()=>void}){
  if(mode==='demo')return <div className="admin-context demo-context"><Sparkles size={16}/>ДЕМО-РЕЖИМ · изменения не сохраняются</div>
  if(!venue)return null
  return <div className="admin-context">
    <ShieldCheck size={16}/>{role==='SUPER_ADMIN'?'Главный администратор':'Владелец'} → {venue.companyName} → {venue.name}
    {role==='SUPER_ADMIN'&&<button onClick={onBack}>Вернуться к платформе</button>}
  </div>
}
