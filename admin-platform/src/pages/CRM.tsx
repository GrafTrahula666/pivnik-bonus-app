import { useState } from 'react'
import {
  Coins, Filter, MoreHorizontal, Pencil, Plus, Search, Trophy, X,
} from 'lucide-react'
import { customers, venues } from '../demoData'
import { scopedCustomers, type Customer, type Session } from '../domain'
import {
  ConfirmModal, Detail, EmptyState, LevelBadge, PageHead, PlatformTag, Status,
  TablePagination, rub,
} from '../ui'

export function ClientsPage({
  session,
  venueId,
  onAudit,
  flash,
}: {
  session: Session
  venueId: string
  onAudit: (entity: string, summary: string) => void
  flash: (text: string) => void
}) {
  const venue = venues.find((item) => item.id === venueId)!
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('Все')
  const [sort, setSort] = useState<'spend' | 'visits'>('spend')
  const [selected, setSelected] = useState<Customer | null>(null)

  const scoped = scopedCustomers(session, venue, customers)
  const list = scoped
    .filter((customer) =>
      customer.name.toLowerCase().includes(query.toLowerCase()) &&
      (status === 'Все' || customer.status === status))
    .sort((left, right) =>
      sort === 'spend'
        ? right.lifetimeSpend - left.lifetimeSpend
        : right.visits - left.visits)

  return (
    <div className="page">
      <PageHead
        eyebrow="CRM"
        title="Клиенты"
        sub={`${scoped.length} клиентов в выбранном заведении · демонстрационные данные`}
        actions={<button className="btn" onClick={() => flash('Выберите клиента в таблице для начисления бонусов')}><Plus size={16} />Добавить бонусы</button>}
      />

      <div className="toolbar card">
        <label className="search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по имени…"
          />
        </label>
        <div className="toolbar-filters">
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option>Все</option>
            <option>Активен</option>
            <option>Новый</option>
            <option>Спит</option>
          </select>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as 'spend' | 'visits')}
          >
            <option value="spend">По выручке</option>
            <option value="visits">По визитам</option>
          </select>
          <button className="btn secondary" onClick={() => setStatus(status === 'Все' ? 'Активен' : 'Все')}><Filter size={15} />Фильтры</button>
        </div>
      </div>

      <div className="table-card card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Клиент</th><th>Баланс</th><th>Кэшбэк</th><th>Уровень</th>
                <th>Визиты</th><th>LTV</th><th>Средний чек</th><th>Последний визит</th>
                <th>VK / TG</th><th>Статус</th><th />
              </tr>
            </thead>
            <tbody>
              {list.map((customer) => (
                <tr key={customer.id} onClick={() => setSelected(customer)}>
                  <td>
                    <div className="person">
                      <div className="avatar">{customer.initials}</div>
                      <div>
                        <b>{customer.name}</b>
                        <span>ID · {customer.id.slice(-4)}</span>
                      </div>
                    </div>
                  </td>
                  <td><strong>{rub.format(customer.balance)}</strong></td>
                  <td>{customer.cashback}%</td>
                  <td><LevelBadge level={customer.level} /></td>
                  <td>{customer.visits}</td>
                  <td>₽ {rub.format(customer.lifetimeSpend)}</td>
                  <td>₽ {rub.format(customer.averageCheck)}</td>
                  <td>{customer.lastVisit}</td>
                  <td><PlatformTag value={customer.platform} /></td>
                  <td><Status value={customer.status} /></td>
                  <td><MoreHorizontal size={17} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TablePagination count={list.length} total={scoped.length} />
      </div>

      {list.length === 0 && (
        <EmptyState title="Клиенты не найдены" sub="Измените поисковый запрос или фильтры." />
      )}

      {selected && (
        <ClientDrawer
          customer={selected}
          onClose={() => setSelected(null)}
          onAudit={onAudit}
          flash={flash}
        />
      )}
    </div>
  )
}

function ClientDrawer({
  customer,
  onClose,
  onAudit,
  flash,
}: {
  customer: Customer
  onClose: () => void
  onAudit: (entity: string, summary: string) => void
  flash: (text: string) => void
}) {
  const [action, setAction] = useState<'bonus' | 'achievement' | null>(null)

  return (
    <div className="drawer-layer">
      <button className="drawer-scrim" onClick={onClose} aria-label="Закрыть карточку" />
      <aside className="drawer">
        <div className="drawer-head">
          <div className="person big">
            <div className="avatar lg">{customer.initials}</div>
            <div>
              <span className="eyebrow">КАРТОЧКА КЛИЕНТА</span>
              <h2>{customer.name}</h2>
              <span>{customer.platform} · с {customer.registeredAt}</span>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}><X /></button>
        </div>

        <div className="drawer-actions">
          <button className="btn" onClick={() => setAction('bonus')}>
            <Coins size={15} />Бонусы
          </button>
          <button className="btn secondary" onClick={() => setAction('achievement')}>
            <Trophy size={15} />Награда
          </button>
          <button className="btn secondary" onClick={() => flash('Профиль открыт в demo-режиме редактирования')}><Pencil size={15} />Изменить</button>
        </div>

        <div className="detail-grid">
          <Detail label="Баланс" value={rub.format(customer.balance)} />
          <Detail label="Сумма покупок" value={`₽ ${rub.format(customer.lifetimeSpend)}`} />
          <Detail label="Средний чек" value={`₽ ${rub.format(customer.averageCheck)}`} />
          <Detail label="Визитов" value={String(customer.visits)} />
          <Detail label="Начислено" value={rub.format(customer.earned)} />
          <Detail label="Списано" value={rub.format(customer.redeemed)} />
        </div>

        <h3 className="section-title">Прогресс</h3>
        <div className="progress-card">
          <div><LevelBadge level={customer.level} /><b>{customer.cashback}% кэшбэк</b></div>
          <div className="progress"><i style={{ width: '72%' }} /></div>
          <span>28 400 ₽ до следующего уровня</span>
        </div>

        <h3 className="section-title">История</h3>
        <div className="timeline">
          {[
            ['Сегодня · 22:14', 'Покупка', 'Чек на 1 860 ₽ · +130 бонусов'],
            ['27 августа · 20:08', 'Колесо', 'Выигрыш 300 бонусов'],
            ['24 августа · 19:41', 'Визит', 'Списано 650 бонусов'],
            ['18 августа · 21:11', 'Достижение', 'Получено «Завсегдатай»'],
            ['12 августа · 18:32', 'Покупка', 'Чек на 2 490 ₽ · +174 бонуса'],
          ].map(([date, title, sub]) => (
            <div className="timeline-row" key={date}>
              <i />
              <div><span>{date}</span><b>{title}</b><p>{sub}</p></div>
            </div>
          ))}
        </div>

        {action && (
          <ConfirmModal
            title={action === 'bonus' ? 'Начислить бонусы' : 'Выдать достижение'}
            text={
              action === 'bonus'
                ? `Начислить 500 бонусов клиенту ${customer.name}?`
                : `Выдать «Завсегдатай» клиенту ${customer.name}?`
            }
            onCancel={() => setAction(null)}
            onConfirm={() => {
              onAudit(
                action === 'bonus' ? 'Клиент' : 'Достижение',
                action === 'bonus'
                  ? `+500 бонусов · ${customer.name}`
                  : `Выдано «Завсегдатай» · ${customer.name}`,
              )
              flash('Операция сохранена в демо')
              setAction(null)
            }}
          />
        )}
      </aside>
    </div>
  )
}
