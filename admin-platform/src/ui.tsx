import type { ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Save,
  Search,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react'
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'

export const rub = new Intl.NumberFormat('ru-RU')
export const pct = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })

export function cn(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(' ')
}

export function PageHead({
  eyebrow,
  title,
  sub,
  actions,
}: {
  eyebrow: string
  title: string
  sub: string
  actions?: ReactNode
}) {
  return (
    <div className="page-head">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}

export function CardTitle({
  title,
  action,
  onAction,
}: {
  title: string
  action?: string
  onAction?: () => void
}) {
  return (
    <div className="card-title">
      <h3>{title}</h3>
      {action && (
        <button onClick={onAction}>
          {action}
          <ArrowUpRight size={14} />
        </button>
      )}
    </div>
  )
}

export function Kpi({
  label,
  value,
  delta,
  down,
  spark,
}: {
  label: string
  value: string
  delta: string
  down?: boolean
  spark: number
}) {
  const data = Array.from({ length: 14 }, (_, index) => ({
    value: 15 + ((index * 13 + spark * 11) % 22) + index * 1.7,
  }))

  return (
    <div className="kpi card">
      <div className="kpi-top">
        <span>{label}</span>
        <span className="ghost-icon info-icon" role="img" aria-label="Определение метрики" title="Определение метрики">
          <CircleHelp size={14} />
        </span>
      </div>
      <div className="kpi-value">{value}</div>
      <div className={cn('delta', down && 'negative')}>
        {down ? <TrendingDown /> : <TrendingUp />}
        {delta}
        <span>к периоду</span>
      </div>
      <div className="spark">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <Area
              type="monotone"
              dataKey="value"
              stroke={down ? '#ff7a90' : '#b9ff66'}
              fill="none"
              strokeWidth={1.5}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export function MiniInsight({
  title,
  value,
  sub,
  children,
}: {
  title: string
  value: string
  sub: string
  children: ReactNode
}) {
  return (
    <div className="card mini-insight">
      <div>
        <span>{title}</span>
        <b>{value}</b>
        <small>{sub}</small>
      </div>
      <div className="mini-viz">{children}</div>
    </div>
  )
}

export function Donut({ value }: { value: number }) {
  const data = [{ value }, { value: 100 - value }]
  return (
    <ResponsiveContainer width={72} height={72}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          innerRadius={24}
          outerRadius={31}
          startAngle={90}
          endAngle={-270}
          stroke="none"
        >
          <Cell fill="#b9ff66" />
          <Cell fill="#25292e" />
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  )
}

export function LevelBadge({ level }: { level: string }) {
  return <span className={cn('level-badge', `level-${level.toLowerCase()}`)}>{level}</span>
}

export function PlatformTag({ value }: { value: string }) {
  return <span className="platform-tag">{value}</span>
}

export function Status({ value }: { value: string }) {
  const okay = ['Активен', 'Активна', 'Активно', 'Успешно'].includes(value)
  return <span className={cn('status', okay && 'ok', value === 'Новый' && 'new')}>{value}</span>
}

export function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  )
}

export function Toggle({
  value,
  onChange,
}: {
  value: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <button
      type="button"
      aria-label={value ? 'Выключить' : 'Включить'}
      className={cn('toggle', value && 'on')}
      onClick={() => onChange(!value)}
    >
      <i />
    </button>
  )
}

export function Field({
  label,
  value,
  type = 'text',
  onChange,
}: {
  label: string
  value: string | number
  type?: string
  onChange: (value: string) => void
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

export function EmptyState({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="empty card">
      <Search />
      <h3>{title}</h3>
      <p>{sub}</p>
    </div>
  )
}

export function TablePagination({ count, total }: { count: number; total: number }) {
  return (
    <div className="table-foot">
      <span>
        Показано {count} из {total}
      </span>
      <div>
        <button disabled>
          <ChevronLeft />
        </button>
        <button className="active" disabled aria-current="page" title="Текущая страница">1</button>
        <button onClick={() => window.alert('Demo page 2')}>2</button>
        <button onClick={() => window.alert('Demo next page')}>
          <ChevronRight />
        </button>
      </div>
    </div>
  )
}

export function ConfirmModal({
  title,
  text,
  onCancel,
  onConfirm,
}: {
  title: string
  text: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="modal-layer">
      <button className="modal-scrim" onClick={onCancel} aria-label="Закрыть" />
      <div className="modal confirm">
        <div className="confirm-icon">
          <AlertTriangle />
        </div>
        <h3>{title}</h3>
        <p>{text}</p>
        <div className="modal-actions">
          <button className="btn secondary" onClick={onCancel}>
            Отмена
          </button>
          <button className="btn" onClick={onConfirm}>
            <Check />
            Подтвердить
          </button>
        </div>
      </div>
    </div>
  )
}

export function EditorModal({
  title,
  children,
  onCancel,
  onSave,
}: {
  title: string
  children: ReactNode
  onCancel: () => void
  onSave: () => void
}) {
  return (
    <div className="modal-layer">
      <button className="modal-scrim" onClick={onCancel} aria-label="Закрыть" />
      <div className="modal editor-modal">
        <div className="modal-head">
          <div>
            <span className="eyebrow">РЕДАКТОР</span>
            <h2>{title}</h2>
          </div>
          <button className="icon-btn" onClick={onCancel}>
            <X />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-actions">
          <button className="btn secondary" onClick={onCancel}>
            Отмена
          </button>
          <button className="btn" onClick={onSave}>
            <Save />
            Сохранить
          </button>
        </div>
      </div>
    </div>
  )
}
