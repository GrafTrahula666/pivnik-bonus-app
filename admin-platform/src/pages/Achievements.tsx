import { useState } from 'react'
import { Gift, Pencil, Plus, Target, Trophy } from 'lucide-react'
import { achievements as achievementSeed } from '../demoData'
import type { Achievement } from '../domain'
import { EditorModal, Field, PageHead, Status, Toggle, cn, pct } from '../ui'

type AuditFn = (entity: string, summary: string) => void
type FlashFn = (text: string) => void

export function AchievementsPage({ onAudit, flash }: { onAudit: AuditFn; flash: FlashFn }) {
  const [items, setItems] = useState<Achievement[]>(achievementSeed)
  const [edit, setEdit] = useState<Achievement | null>(null)

  function blank(): Achievement {
    return {
      id: crypto.randomUUID(),
      title: '',
      description: '',
      rarity: 'Обычное',
      condition: 'visits ≥ 1',
      reward: '100 бонусов',
      enabled: true,
      hidden: false,
      unlocked: 0,
    }
  }

  return (
    <div className="page">
      <PageHead
        eyebrow="ГЕЙМИФИКАЦИЯ"
        title="Достижения"
        sub="Условия, редкость и награды за прогресс"
        actions={<button className="btn" onClick={() => setEdit(blank())}><Plus />Достижение</button>}
      />
      <div className="achievement-grid">
        {items.map((item, index) => (
          <article className="achievement-card card" key={item.id}>
            <div className={cn('achievement-icon', `rarity-${index % 4}`)}><Trophy /></div>
            <div className="grow">
              <div className="achievement-title">
                <span className="eyebrow">{item.rarity.toUpperCase()}</span>
                <Status value={item.enabled ? 'Активен' : 'Пауза'} />
              </div>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              <div className="achievement-meta">
                <span><Target /> {item.condition}</span>
                <span><Gift /> {item.reward}</span>
                {item.hidden && <span>Скрытое</span>}
              </div>
            </div>
            <div className="achievement-stat">
              <b>{item.unlocked}</b>
              <span>получили</span>
              <strong>{pct.format(item.unlocked / 8.49)}%</strong>
            </div>
            <button className="ghost-icon" onClick={() => setEdit(item)}><Pencil /></button>
          </article>
        ))}
      </div>

      {edit && (
        <EditorModal
          title="Редактор достижения"
          onCancel={() => setEdit(null)}
          onSave={() => {
            setItems((current) => current.some((item) => item.id === edit.id)
              ? current.map((item) => item.id === edit.id ? edit : item)
              : [edit, ...current])
            onAudit('Достижение', `${edit.title || 'Новое'} · сохранено`)
            flash('Достижение сохранено')
            setEdit(null)
          }}
        >
          <Field label="Название" value={edit.title} onChange={(value) => setEdit({ ...edit, title: value })} />
          <Field label="Описание" value={edit.description} onChange={(value) => setEdit({ ...edit, description: value })} />
          <label className="field">
            <span>Редкость</span>
            <select value={edit.rarity} onChange={(event) => setEdit({ ...edit, rarity: event.target.value as Achievement['rarity'] })}>
              <option>Обычное</option><option>Редкое</option><option>Эпическое</option><option>Легендарное</option>
            </select>
          </label>
          <Field label="Условие" value={edit.condition} onChange={(value) => setEdit({ ...edit, condition: value })} />
          <Field label="Награда" value={edit.reward} onChange={(value) => setEdit({ ...edit, reward: value })} />
          <div className="setting-row"><span>Активно</span><Toggle value={edit.enabled} onChange={(value) => setEdit({ ...edit, enabled: value })} /></div>
          <div className="setting-row"><span>Скрытое</span><Toggle value={edit.hidden} onChange={(value) => setEdit({ ...edit, hidden: value })} /></div>
        </EditorModal>
      )}
    </div>
  )
}
