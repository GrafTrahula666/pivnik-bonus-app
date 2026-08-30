import { useState } from 'react'
import { AlertTriangle, Gift, Save, Sparkles } from 'lucide-react'
import { wheelPrizes as wheelSeed } from '../demoData'
import {
  validateLevels,
  wheelProbabilityTotal,
  type LoyaltyLevel,
  type WheelPrize,
} from '../domain'
import { CardTitle, Field, PageHead, Toggle, cn, rub } from '../ui'

type AuditFn = (entity: string, summary: string) => void
type FlashFn = (text: string) => void

export function LoyaltyPage({ onAudit, flash }: { onAudit: AuditFn; flash: FlashFn }) {
  const [base, setBase] = useState(7)
  const [registration, setRegistration] = useState(300)
  const [referral, setReferral] = useState(500)
  const [levels, setLevels] = useState<LoyaltyLevel[]>([
    { id: 'l1', name: 'Bronze', threshold: 0, cashback: 5, enabled: true },
    { id: 'l2', name: 'Silver', threshold: 15000, cashback: 7, enabled: true },
    { id: 'l3', name: 'Gold', threshold: 50000, cashback: 10, enabled: true },
    { id: 'l4', name: 'VIP', threshold: 120000, cashback: 15, enabled: true },
  ])
  const errors = validateLevels(levels)

  function update(
    id: string,
    key: keyof LoyaltyLevel,
    value: string | number | boolean,
  ) {
    setLevels((items) =>
      items.map((item) => item.id === id ? { ...item, [key]: value } : item))
  }

  return (
    <div className="page">
      <PageHead
        eyebrow="КОНСТРУКТОР"
        title="Лояльность"
        sub="Правила начисления, welcome-механика и уровни клиентов"
        actions={
          <button
            className="btn"
            disabled={errors.length > 0}
            onClick={() => {
              onAudit('Лояльность', `Базовый кэшбэк → ${base}%`)
              flash('Настройки лояльности сохранены')
            }}
          >
            <Save size={16} />Сохранить
          </button>
        }
      />
      <div className="editor-layout">
        <section className="card editor-card">
          <CardTitle title="Базовые правила" />
          <div className="form-grid three">
            <Field label="Базовый кэшбэк, %" value={base} type="number" onChange={(value) => setBase(+value)} />
            <Field label="Бонус регистрации" value={registration} type="number" onChange={(value) => setRegistration(+value)} />
            <Field label="Реферальный бонус" value={referral} type="number" onChange={(value) => setReferral(+value)} />
          </div>
        </section>

        <section className="card editor-card">
          <CardTitle
            title="Уровни"
            action="+ Добавить"
            onAction={() =>
              setLevels((items) => [
                ...items,
                {
                  id: crypto.randomUUID(),
                  name: 'Новый уровень',
                  threshold: (items.at(-1)?.threshold ?? 0) + 50000,
                  cashback: 5,
                  enabled: true,
                },
              ])}
          />
          <div className="level-builder">
            {levels.map((level, index) => (
              <div className="level-row" key={level.id}>
                <div className="drag">⋮⋮</div>
                <span className="level-index">0{index + 1}</span>
                <input
                  value={level.name}
                  aria-label="Название уровня"
                  onChange={(event) => update(level.id, 'name', event.target.value)}
                />
                <label>
                  <span>Порог</span>
                  <input
                    type="number"
                    value={level.threshold}
                    onChange={(event) => update(level.id, 'threshold', +event.target.value)}
                  />
                </label>
                <label>
                  <span>Кэшбэк</span>
                  <div className="input-suffix">
                    <input
                      type="number"
                      value={level.cashback}
                      onChange={(event) => update(level.id, 'cashback', +event.target.value)}
                    />
                    <i>%</i>
                  </div>
                </label>
                <Toggle value={level.enabled} onChange={(value) => update(level.id, 'enabled', value)} />
                <button
                  className="ghost-icon"
                  aria-label={`Удалить ${level.name}`}
                  onClick={() => setLevels((items) => items.filter((item) => item.id !== level.id))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          {errors.length > 0 && (
            <div className="validation"><AlertTriangle size={16} />{errors.join(' · ')}</div>
          )}
        </section>

        <section className="card preview-card">
          <span className="eyebrow">ПРЕДПРОСМОТР</span>
          <h3>Путь клиента</h3>
          <div className="level-preview">
            {levels.filter((level) => level.enabled).map((level) => (
              <div key={level.id}>
                <b>{level.name}</b>
                <strong>{level.cashback}%</strong>
                <small>от ₽ {rub.format(level.threshold)}</small>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

export function WheelPage({ onAudit, flash }: { onAudit: AuditFn; flash: FlashFn }) {
  const [prizes, setPrizes] = useState<WheelPrize[]>(wheelSeed)
  const [enabled, setEnabled] = useState(true)
  const [cooldown, setCooldown] = useState(24)
  const [retryCost, setRetryCost] = useState(150)
  const total = wheelProbabilityTotal(prizes)

  function update(
    id: string,
    key: keyof WheelPrize,
    value: string | number | boolean | null,
  ) {
    setPrizes((items) =>
      items.map((item) => item.id === id ? { ...item, [key]: value } : item))
  }

  return (
    <div className="page">
      <PageHead
        eyebrow="КОНСТРУКТОР"
        title="Колесо"
        sub="Вероятности, награды и экономика игровой механики"
        actions={
          <button
            className="btn"
            disabled={total !== 100}
            onClick={() => {
              onAudit('Колесо', 'Конфигурация призов опубликована')
              flash('Конфигурация колеса сохранена')
            }}
          >
            <Save size={16} />Опубликовать
          </button>
        }
      />

      <div className="wheel-top">
        <section className="card wheel-visual">
          <div className="wheel-ring">
            {prizes.slice(0, 6).map((prize, index) => (
              <div
                key={prize.id}
                className="wheel-label"
                style={{
                  transform: `rotate(${index * 60}deg) translateY(-112px) rotate(${-index * 60}deg)`,
                }}
              >
                <Gift size={18} />
              </div>
            ))}
            <div className="wheel-center"><Sparkles /><b>SPIN</b></div>
          </div>
          <div className="prob-total">
            <span>Сумма вероятностей</span>
            <strong className={cn(total !== 100 && 'bad')}>{total}%</strong>
            <small>{total === 100 ? 'Готово к публикации' : 'Должно быть ровно 100%'}</small>
          </div>
        </section>

        <section className="card editor-card">
          <CardTitle title="Настройки механики" />
          <div className="setting-row">
            <div><b>Колесо активно</b><span>Доступно клиентам</span></div>
            <Toggle value={enabled} onChange={setEnabled} />
          </div>
          <div className="form-grid two">
            <Field label="Cooldown, часов" value={cooldown} type="number" onChange={(value) => setCooldown(+value)} />
            <Field label="Повторная попытка" value={retryCost} type="number" onChange={(value) => setRetryCost(+value)} />
          </div>
          <div className="mini-stats">
            <div><span>Спинов · 30д</span><b>4 821</b><small>+19,2%</small></div>
            <div><span>Получено призов</span><b>3 944</b><small>81,8%</small></div>
            <div><span>Retry spend</span><b>94 350</b><small>бонусов</small></div>
          </div>
        </section>
      </div>

      <section className="card editor-card">
        <CardTitle
          title="Призы"
          action="+ Добавить приз"
          onAction={() =>
            setPrizes((items) => [
              ...items,
              {
                id: crypto.randomUUID(),
                title: 'Новый приз',
                probability: 0,
                rewardType: 'bonus',
                value: 100,
                inventory: null,
                enabled: true,
              },
            ])}
        />
        <div className="prize-list">
          <div className="prize-head">
            <span>Приз</span><span>Тип</span><span>Значение</span>
            <span>Вероятность</span><span>Лимит</span><span>Статус</span><span />
          </div>
          {prizes.map((prize) => (
            <div className="prize-row" key={prize.id}>
              <div className="prize-name">
                <div className="prize-icon"><Gift /></div>
                <input value={prize.title} onChange={(event) => update(prize.id, 'title', event.target.value)} />
              </div>
              <select value={prize.rewardType} onChange={(event) => update(prize.id, 'rewardType', event.target.value)}>
                <option value="bonus">Бонусы</option><option value="item">Предмет</option><option value="retry">Retry</option>
              </select>
              <input type="number" value={prize.value} onChange={(event) => update(prize.id, 'value', +event.target.value)} />
              <div className="input-suffix">
                <input type="number" value={prize.probability} onChange={(event) => update(prize.id, 'probability', +event.target.value)} />
                <i>%</i>
              </div>
              <input
                type="number"
                value={prize.inventory ?? ''}
                placeholder="∞"
                onChange={(event) => update(prize.id, 'inventory', event.target.value ? +event.target.value : null)}
              />
              <Toggle value={prize.enabled} onChange={(value) => update(prize.id, 'enabled', value)} />
              <button
                className="ghost-icon"
                aria-label={`Удалить ${prize.title}`}
                onClick={() => setPrizes((items) => items.filter((item) => item.id !== prize.id))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        {total !== 100 && (
          <div className="validation">
            <AlertTriangle size={16} />
            Публикация заблокирована: сумма вероятностей {total}%, требуется 100%.
          </div>
        )}
      </section>

      <section className="card editor-card">
        <CardTitle title="Историческое распределение · 30 дней" />
        <div className="distribution">
          {prizes.slice(0, 5).map((prize, index) => (
            <div key={prize.id}>
              <span>{prize.title}</span>
              <div><i style={{ width: `${Math.min(100, prize.probability * 2.25)}%` }} /></div>
              <b>{[1639, 965, 728, 963, 337][index] ?? 0}</b>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
