import { useMemo, useState } from 'react'
import {
  Activity, CircleDollarSign, CircleHelp, Coins, Crown, FileText, Gift, ShieldCheck,
  TrendingUp, UserRound, WalletCards, Zap, ChevronRight,
} from 'lucide-react'
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { Page } from '../appTypes'
import type { Period } from '../layout'
import { customers, makeSeries, venues } from '../demoData'
import { scopedCustomers } from '../domain'
import {
  CardTitle, Donut, Kpi, MiniInsight, PageHead, rub,
} from '../ui'

const kpis = [
  ['Выручка зарегистрированных', '₽ 4 826 400', '+18,4%', false],
  ['Количество чеков', '3 284', '+12,7%', false],
  ['Средний чек', '₽ 1 470', '+5,1%', false],
  ['Клиентов всего', '8 492', '+9,2%', false],
  ['Новых клиентов', '618', '+21,6%', false],
  ['Активных клиентов', '2 941', '+13,8%', false],
  ['Повторных клиентов', '1 974', '+8,7%', false],
  ['Начислено бонусов', '347 501', '+16,2%', false],
  ['Списано бонусов', '211 840', '+24,1%', false],
  ['Баланс бонусов', '1 284 600', '+4,6%', false],
  ['Посещений', '3 611', '+11,3%', false],
  ['Redemption Rate', '61,0%', '-2,4%', true],
] as const

type Metric = 'revenue' | 'visits' | 'customers' | 'bonuses'

function ChartTooltip({
  active,
  payload,
  label,
  metric,
}: {
  active?: boolean
  payload?: Array<{ value: number }>
  label?: string
  metric: Metric
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <span>{label}</span>
      <b>{metric === 'revenue' ? `₽ ${rub.format(payload[0].value)}` : rub.format(payload[0].value)}</b>
    </div>
  )
}

function ActivityIcon({ kind }: { kind: string }) {
  const Icon =
    kind === 'bonus' ? Coins :
    kind === 'level' ? Crown :
    kind === 'wheel' ? Gift :
    kind === 'user' ? UserRound :
    CircleDollarSign
  return <div className="activity-icon"><Icon /></div>
}

export function VenueOverview({
  venueName,
  period,
  compare,
  onNavigate,
}: {
  venueName: string
  period: Period
  compare: boolean
  onNavigate: (page: Page) => void
}) {
  const [metric, setMetric] = useState<Metric>('revenue')
  const series = useMemo(() => {
    const all = makeSeries(5)
    const size = period === 'Сегодня' ? 1 : period === '7 дней' ? 7 : period === '30 дней' ? 30 : 90
    return all.slice(-size)
  }, [period])

  return (
    <div className="page">
      <PageHead
        eyebrow="ОБЗОР ЗАВЕДЕНИЯ"
        title={venueName}
        sub={`Ключевые показатели · ${period.toLowerCase()} · демонстрационные данные`}
        actions={<button className="btn secondary" onClick={() => window.alert('Demo-отчёт подготовлен локально')}><FileText size={16} />Экспорт отчёта</button>}
      />

      <div className="kpi-grid">
        {kpis.map(([label, value, delta, down], index) => (
          <Kpi key={label} label={label} value={value} delta={delta} down={down} spark={index} />
        ))}
      </div>

      <div className="grid-main">
        <section className="card chart-card">
          <div className="card-head">
            <div>
              <span className="eyebrow">ДИНАМИКА</span>
              <h3>₽ 4,83 млн <span className="metric-delta"><TrendingUp size={15} />18,4%</span></h3>
            </div>
            <div className="segmented">
              {[
                ['revenue', 'Выручка'],
                ['visits', 'Посещения'],
                ['customers', 'Клиенты'],
                ['bonuses', 'Бонусы'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  className={metric === id ? 'active' : ''}
                  onClick={() => setMetric(id as Metric)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ left: 0, right: 4, top: 12, bottom: 0 }}>
                <defs>
                  <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#b9ff66" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#b9ff66" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#22262b" strokeDasharray="4 4" />
                <XAxis
                  dataKey="day"
                  tick={{ fill: '#777e88', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: '#777e88', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  tickFormatter={(value: number) => metric === 'revenue' ? `${Math.round(value / 1000)}k` : String(value)}
                />
                <Tooltip content={<ChartTooltip metric={metric} />} />
                {compare && (
                  <Area
                    type="monotone"
                    dataKey={metric === 'revenue' ? 'previous' : metric}
                    stroke="#515862"
                    strokeWidth={1.5}
                    fill="none"
                    strokeDasharray="5 5"
                  />
                )}
                <Area type="monotone" dataKey={metric} stroke="#b9ff66" strokeWidth={2} fill="url(#chartFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-legend">
            <span className="legend-now" />Текущий период
            {compare && <><span className="legend-prev" />Предыдущий период</>}
          </div>
        </section>

        <section className="card quick-card">
          <div className="card-head">
            <div><span className="eyebrow">УПРАВЛЕНИЕ</span><h3>Быстрые настройки</h3></div>
            <Zap size={18} />
          </div>
          {[
            ['Кэшбэк', '7%', 'loyalty'],
            ['Бонус регистрации', '300', 'loyalty'],
            ['Реферальный бонус', '500', 'loyalty'],
            ['Колесо', 'Включено', 'wheel'],
            ['Магазин', 'Включен', 'shop'],
            ['Достижения', '12 активно', 'achievements'],
            ['Акции', '2 запущено', 'promotions'],
          ].map(([label, value, page]) => (
            <button className="quick-row" key={label} onClick={() => onNavigate(page as Page)}>
              <span>{label}</span><b>{value}</b><ChevronRight size={15} />
            </button>
          ))}
          <div className="safety-note">
            <ShieldCheck size={16} />
            <span>Критические настройки открываются в отдельном редакторе и требуют сохранения.</span>
          </div>
        </section>
      </div>

      <div className="analytics-grid">
        <MiniInsight title="Новые / повторные" value="38% / 62%" sub="Доля клиентов за период">
          <Donut value={62} />
        </MiniInsight>
        <MiniInsight title="Retention" value="7д · 68%" sub="30д · 47%  ·  90д · 31%">
          <div className="ret-bars"><i style={{ width: '68%' }} /><i style={{ width: '47%' }} /><i style={{ width: '31%' }} /></div>
        </MiniInsight>
        <MiniInsight title="Частота визитов" value="2,8 раза / мес." sub="+0,3 к прошлому периоду">
          <div className="frequency"><Activity /><strong>↑ 12%</strong></div>
        </MiniInsight>
        <MiniInsight title="Платформы" value="VK 46% · TG 41%" sub="Обе платформы · 13%">
          <div className="platform-split"><i /><i /><i /></div>
        </MiniInsight>
      </div>

      <div className="two-cols">
        <section className="card list-card">
          <CardTitle title="Топ клиентов" action="Все клиенты" onAction={() => onNavigate('clients')} />
          <div className="compact-list">
            {customers.slice(0, 5).map((customer, index) => (
              <div className="rank-row" key={customer.id}>
                <span className="rank">0{index + 1}</span>
                <div className="avatar">{customer.initials}</div>
                <div className="grow"><b>{customer.name}</b><span>{customer.visits} визитов · {customer.level}</span></div>
                <strong>₽ {rub.format(customer.lifetimeSpend)}</strong>
              </div>
            ))}
          </div>
        </section>
        <section className="card list-card">
          <CardTitle title="Последняя активность" action="Журнал" onAction={() => onNavigate('audit')} />
          <div className="activity-list">
            {[
              ['+1 420 ₽', 'Чек · Анна Смирнова', '2 мин', 'receipt'],
              ['−650', 'Списание бонусов · Максим Волков', '8 мин', 'bonus'],
              ['Gold', 'Новый уровень · Екатерина Морозова', '21 мин', 'level'],
              ['+300', 'Колесо · Алексей Орлов', '34 мин', 'wheel'],
              ['Новый', 'Регистрация · Мария Соколова', '41 мин', 'user'],
            ].map(([value, label, time, kind]) => (
              <div className="activity-row" key={label}>
                <ActivityIcon kind={kind} />
                <div className="grow"><b>{label}</b><span>{time} назад</span></div>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

export function OperationsPage({ venueId }: { venueId: string }) {
  const venue = venues.find((item) => item.id === venueId)!
  const rows = scopedCustomers(
    { id: 'super', name: 'Super', role: 'SUPER_ADMIN', companyIds: [] },
    venue,
    customers,
  ).slice(0, 14)

  return (
    <div className="page">
      <PageHead
        eyebrow="ФИНАНСЫ"
        title="Операции"
        sub="Локальный demo-журнал начислений, списаний и чеков"
        actions={<button className="btn secondary" onClick={() => window.alert('Demo CSV export')}><FileText />Экспорт CSV</button>}
      />
      <div className="summary-strip card">
        <div><CircleDollarSign /><span>Выручка</span><b>₽ 4,83 млн</b></div>
        <div><Coins /><span>Начислено</span><b>347 501</b></div>
        <div><WalletCards /><span>Списано</span><b>211 840</b></div>
        <div><Activity /><span>Операций</span><b>6 281</b></div>
      </div>
      <div className="table-card card">
        <div className="table-scroll">
          <table>
            <thead><tr><th>Время</th><th>Клиент</th><th>Тип</th><th>Чек</th><th>Бонусы</th><th>Канал</th><th>Статус</th></tr></thead>
            <tbody>
              {rows.map((customer, index) => (
                <tr key={customer.id}>
                  <td>{String(22 - (index % 8)).padStart(2, '0')}:{String((index * 7) % 60).padStart(2, '0')}</td>
                  <td><b>{customer.name}</b></td>
                  <td>{index % 3 === 0 ? 'Списание' : 'Начисление + чек'}</td>
                  <td>₽ {rub.format(customer.averageCheck + index * 73)}</td>
                  <td>{index % 3 === 0 ? '−' : '+'}{80 + index * 19}</td>
                  <td>{customer.platform}</td>
                  <td><span className="status ok">Успешно</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export function AnalyticsPage() {
  const data = makeSeries(33)
  const funnel = [
    ['Регистрация', 8492, 100],
    ['1-й визит', 6710, 79],
    ['2-й визит', 4612, 54],
    ['Активен 30д', 2941, 35],
    ['5+ визитов', 1820, 21],
  ] as const

  return (
    <div className="page">
      <PageHead
        eyebrow="BI"
        title="Аналитика"
        sub="Демонстрационные показатели для знакомства с возможностями панели"
      />
      <div className="analytics-grid wide">
        <MiniInsight title="DAU / WAU / MAU" value="1 428 / 3 916 / 6 207" sub="Stickiness DAU/MAU · 23%"><Activity /></MiniInsight>
        <MiniInsight title="Retention 30d" value="47,3%" sub="+4,1 п.п. к прошлому периоду"><TrendingUp /></MiniInsight>
        <MiniInsight title="Redemption Rate" value="61,0%" sub="Списано / начислено"><Coins /></MiniInsight>
        <MiniInsight title="Bonus liability" value="1 284 600" sub="Текущий баланс бонусов"><WalletCards /></MiniInsight>
      </div>
      <div className="two-cols">
        <section className="card chart-card">
          <CardTitle title="Клиенты и визиты" />
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <CartesianGrid vertical={false} stroke="#22262b" />
                <XAxis dataKey="day" tick={{ fill: '#777e88', fontSize: 11 }} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: '#777e88', fontSize: 11 }} axisLine={false} />
                <Tooltip />
                <Area type="monotone" dataKey="customers" stroke="#b9ff66" fillOpacity={0.08} />
                <Area type="monotone" dataKey="visits" stroke="#8ca0ff" fillOpacity={0.03} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="card funnel">
          <CardTitle title="Воронка активности" />
          {funnel.map(([label, value, width]) => (
            <div key={label}>
              <span>{label}</span><b>{rub.format(value)}</b>
              <div><i style={{ width: `${width}%` }} /></div><small>{width}%</small>
            </div>
          ))}
        </section>
      </div>
      <div className="definition-card card">
        <CircleHelp />
        <div>
          <b>Определения demo-метрик</b>
          <p>
            DAU/WAU/MAU — уникальные клиенты с meaningful activity за 1/7/30 дней.
            Redemption Rate = списанные бонусы / начисленные бонусы. Retention 30d —
            доля когорты, вернувшаяся в окно 30 дней. Tracked revenue — сумма чеков,
            связанных с зарегистрированным клиентом.
          </p>
        </div>
      </div>
    </div>
  )
}
