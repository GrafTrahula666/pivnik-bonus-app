import {
  Activity,
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  Crown,
  Gift,
  LayoutDashboard,
  LogOut,
  Menu,
  Palette,
  RefreshCcw,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  TicketPercent,
  Trophy,
  Users,
  WalletCards,
} from 'lucide-react'
import type { Page } from './appTypes'
import type { AdminRole, Venue } from './domain'
import { cn } from './ui'

const nav = [
  ['overview', 'Обзор', LayoutDashboard],
  ['clients', 'Клиенты', Users],
  ['operations', 'Операции', WalletCards],
  ['analytics', 'Аналитика', BarChart3],
  ['loyalty', 'Лояльность', Crown],
  ['wheel', 'Колесо', Gift],
  ['achievements', 'Достижения', Trophy],
  ['shop', 'Магазин', ShoppingBag],
  ['promotions', 'Акции', TicketPercent],
  ['brand', 'Оформление', Palette],
  ['settings', 'Настройки', Settings],
  ['audit', 'Журнал', ClipboardList],
] as const

const superNav = [
  ['platform', 'Платформа', Activity],
  ['companies', 'Компании', Building2],
  ['venues', 'Заведения', Store],
] as const

export const periods = ['Сегодня', '7 дней', '30 дней', '3 месяца', 'Год'] as const
export type Period = (typeof periods)[number]

export function Sidebar({
  page,
  role,
  open,
  onClose,
  onPage,
}: {
  page: Page
  role: AdminRole
  open: boolean
  onClose: () => void
  onPage: (page: Page) => void
}) {
  return (
    <>
      {open && <button className="scrim" onClick={onClose} aria-label="Закрыть меню" />}
      <aside className={cn('sidebar', open && 'open')}>
        <div className="brand">
          <div className="brand-mark">C</div>
          <div><b>PIVNIK</b><span>BUSINESS</span></div>
        </div>
        <div className="demo-badge"><Sparkles size={13} /> DEMO DATA</div>
        <nav className="nav">
          {nav.map(([id, label, Icon]) => (
            <button
              key={id}
              className={cn('nav-item', page === id && 'active')}
              onClick={() => onPage(id)}
            >
              <Icon size={17} /><span>{label}</span>
            </button>
          ))}
          {role === 'SUPER_ADMIN' && (
            <>
              <div className="nav-separator"><span>СУПЕР АДМИН</span></div>
              {superNav.map(([id, label, Icon]) => (
                <button
                  key={id}
                  className={cn('nav-item', page === id && 'active')}
                  onClick={() => onPage(id)}
                >
                  <Icon size={17} /><span>{label}</span>
                </button>
              ))}
            </>
          )}
        </nav>
        <div className="sidebar-foot">
          <div className="system-ok">
            <span />
            <div><b>Демо-режим</b><small>изменения не сохраняются</small></div>
          </div>
        </div>
      </aside>
    </>
  )
}

export function Topbar({
  role,
  venueId,
  allowedVenues,
  period,
  compare,
  onMenu,
  onRole,
  onVenue,
  onPeriod,
  onCompare,
}: {
  role: AdminRole
  venueId: string
  allowedVenues: Venue[]
  period: Period
  compare: boolean
  onMenu: () => void
  onRole: (role: AdminRole) => void
  onVenue: (venueId: string) => void
  onPeriod: (period: Period) => void
  onCompare: (value: boolean) => void
}) {
  return (
    <header className="topbar">
      <button className="icon-btn mobile-menu" onClick={onMenu}><Menu size={20} /></button>
      <div className="tenant-select-wrap">
        <select className="tenant-select" value={venueId} onChange={(event) => onVenue(event.target.value)}>
          {allowedVenues.map((venue) => (
            <option key={venue.id} value={venue.id}>{venue.name}</option>
          ))}
        </select>
        <ChevronDown size={15} />
      </div>
      <div className="topbar-grow" />
      <div className="periods desktop-only">
        {periods.map((item) => (
          <button
            key={item}
            className={cn(period === item && 'active')}
            onClick={() => onPeriod(item)}
          >
            {item}
          </button>
        ))}
        <button onClick={() => window.alert('Выбор произвольного периода доступен в demo UI')}><CalendarDays size={14} /> Свой</button>
      </div>
      <label className="compare desktop-only">
        <input
          type="checkbox"
          checked={compare}
          onChange={(event) => onCompare(event.target.checked)}
        />
        <span />
        Сравнение
      </label>
      <button className="icon-btn" onClick={() => window.alert('Новых уведомлений: 3 (demo)')}><Bell size={18} /><i /></button>
      <div className="profile-menu">
        <button className="profile-button">
          <div className="avatar small">{role === 'SUPER_ADMIN' ? 'PA' : 'АМ'}</div>
          <div>
            <b>{role === 'SUPER_ADMIN' ? 'Главный администратор' : 'Алексей Морозов'}</b>
            <span>{role === 'SUPER_ADMIN' ? 'Управление сетью' : 'Владелец'}</span>
          </div>
          <ChevronDown size={14} />
        </button>
        <div className="profile-popover">
          <button onClick={() => onRole(role === 'SUPER_ADMIN' ? 'VENUE_ADMIN' : 'SUPER_ADMIN')}>
            <RefreshCcw size={15} />
            Переключить на {role === 'SUPER_ADMIN' ? 'владельца' : 'главного администратора'}
          </button>
          <button onClick={() => window.alert('Demo session: выход не требуется')}><LogOut size={15} />Выйти из демо</button>
        </div>
      </div>
    </header>
  )
}

export function SuperAdminContext({
  companyName,
  venueName,
  onBack,
}: {
  companyName: string
  venueName: string
  onBack: () => void
}) {
  return (
    <div className="admin-context">
      <ShieldCheck size={16} />
      SUPER ADMIN · Вы просматриваете {companyName} / {venueName}
      <button onClick={onBack}>Вернуться к платформе</button>
    </div>
  )
}
