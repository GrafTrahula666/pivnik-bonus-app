import { ArrowUpRight, FileText, Plus, Store, TrendingUp } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { companies, makeSeries, venues } from '../demoData'
import type { AuditEvent, Session } from '../domain'
import { CardTitle, PageHead, Status, rub } from '../ui'

export function PlatformPage({ onOpenVenue }: { onOpenVenue: (id: string) => void }) {
  const platformSeries = makeSeries(17)
  const health = [94, 89, 92, 71, 87]
  return (
    <div className="page">
      <PageHead
        eyebrow="SUPER ADMIN"
        title="Платформа"
        sub="Агрегированный health-check всей сети · demo dataset"
        actions={<button className="btn secondary" onClick={() => window.alert('Demo platform report')}><FileText />Отчёт платформы</button>}
      />
      <div className="platform-kpis">
        {[
          ['Компании', '4', '+1'], ['Заведения', '5', '+1'], ['Клиентов', '24 861', '+14,2%'],
          ['DAU', '4 208', '+9,8%'], ['WAU', '10 916', '+11,4%'], ['MAU', '18 407', '+12,1%'],
          ['GMV', '₽ 19,8 млн', '+17,6%'], ['Операций', '32 940', '+21,4%'],
        ].map(([label, value, delta]) => (
          <div className="card platform-kpi" key={label}>
            <span>{label}</span><b>{value}</b><strong><TrendingUp />{delta}</strong>
          </div>
        ))}
      </div>

      <div className="grid-main platform-chart-grid">
        <section className="card chart-card">
          <CardTitle title="Рост платформы · 90 дней" />
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={platformSeries}>
                <defs>
                  <linearGradient id="platformFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#b9ff66" stopOpacity=".22" />
                    <stop offset="1" stopColor="#b9ff66" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#22262b" strokeDasharray="4 4" />
                <XAxis dataKey="day" tick={{ fill: '#777e88', fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: '#777e88', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip />
                <Area type="monotone" dataKey="customers" stroke="#b9ff66" fill="url(#platformFill)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="card health-card">
          <CardTitle title="Health заведений" />
          {venues.map((venue, index) => (
            <button key={venue.id} onClick={() => onOpenVenue(venue.id)}>
              <span className={index === 3 ? 'health-dot warm' : 'health-dot'} />
              <div><b>{venue.name}</b><span>{venue.city}</span></div>
              <strong>{health[index]}%</strong><ArrowUpRight />
            </button>
          ))}
        </section>
      </div>
      <CompaniesTable onOpenVenue={onOpenVenue} />
    </div>
  )
}

export function CompaniesTable({ onOpenVenue }: { onOpenVenue: (id: string) => void }) {
  const clientCounts = [8492, 6120, 3744, 6505]
  const mau = [5220, 4031, 2364, 4316]
  const ops = [12940, 8451, 4190, 7359]
  const gmv = [7.4, 5.8, 2.4, 4.2]
  const growth = [18.4, 12.1, 28.3, 9.6]
  return (
    <section className="card table-card">
      <div className="table-section-title"><CardTitle title="Компании" /></div>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Компания</th><th>Заведений</th><th>Клиентов</th><th>MAU</th><th>Операций</th><th>GMV</th><th>Рост</th><th>Статус</th><th /></tr></thead>
          <tbody>
            {companies.map((company, index) => (
              <tr key={company.id}>
                <td><div className="company-cell"><div>{company.name.slice(0, 2)}</div><b>{company.name}</b></div></td>
                <td>{company.venueIds.length}</td><td>{rub.format(clientCounts[index])}</td><td>{rub.format(mau[index])}</td>
                <td>{rub.format(ops[index])}</td><td>₽ {gmv[index]} млн</td>
                <td><span className="metric-delta"><TrendingUp />{growth[index]}%</span></td>
                <td><Status value={company.status} /></td>
                <td><button className="ghost-icon" onClick={() => onOpenVenue(company.venueIds[0])}><ArrowUpRight /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function CompaniesPage({ onOpenVenue }: { onOpenVenue: (id: string) => void }) {
  return (
    <div className="page">
      <PageHead eyebrow="УПРАВЛЕНИЕ СЕТЬЮ" title="Компании" sub="Компании и их ключевые показатели" actions={<button className="btn" onClick={() => window.alert('Создание компании недоступно в демо-режиме')}><Plus />Компания</button>} />
      <CompaniesTable onOpenVenue={onOpenVenue} />
    </div>
  )
}

export function VenuesPage({ onOpenVenue }: { onOpenVenue: (id: string) => void }) {
  const counts = [8492, 4104, 6120, 3744, 6505]
  const gmv = [4.8, 2.6, 5.8, 2.4, 4.2]
  return (
    <div className="page">
      <PageHead eyebrow="УПРАВЛЕНИЕ СЕТЬЮ" title="Заведения" sub="Все заведения доступных компаний" actions={<button className="btn" onClick={() => window.alert('Создание заведения недоступно в демо-режиме')}><Plus />Заведение</button>} />
      <div className="venue-grid">
        {venues.map((venue, index) => (
          <article className="card venue-card" key={venue.id}>
            <div className="venue-thumb"><Store /></div>
            <div>
              <Status value={venue.status} /><h3>{venue.name}</h3><p>{venue.address}, {venue.city}</p>
              <div className="venue-stats">
                <span><b>{counts[index]}</b> клиентов</span><span><b>₽ {gmv[index]}м</b> GMV</span>
              </div>
              <button className="btn secondary" onClick={() => onOpenVenue(venue.id)}>Открыть dashboard <ArrowUpRight /></button>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

export function AuditPage({ session, events }: { session: Session; events: AuditEvent[] }) {
  const visible = session.role === 'SUPER_ADMIN'
    ? events
    : events.filter((event) => session.companyIds.includes(event.companyId))
  return (
    <div className="page">
      <PageHead eyebrow="БЕЗОПАСНОСТЬ" title="Журнал" sub="Изменения администраторов с tenant-aware фильтрацией" />
      <div className="table-card card">
        <div className="table-scroll">
          <table>
            <thead><tr><th>Дата</th><th>Администратор</th><th>Компания</th><th>Заведение</th><th>Действие</th><th>Сущность</th><th>Изменение</th></tr></thead>
            <tbody>
              {visible.map((event) => (
                <tr key={event.id}>
                  <td>{event.timestamp}</td><td><b>{event.admin}</b></td>
                  <td>{companies.find((item) => item.id === event.companyId)?.name}</td>
                  <td>{venues.find((item) => item.id === event.venueId)?.name}</td>
                  <td>{event.action}</td><td>{event.entity}</td><td>{event.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
