import { useState, type CSSProperties } from 'react'
import { Gift, Palette, Save, ShieldCheck, ShoppingBag, Trophy } from 'lucide-react'
import { Field, PageHead, Toggle } from '../ui'

type AuditFn = (entity: string, summary: string) => void
type FlashFn = (text: string) => void

export function BrandPage({
  venueName,
  onAudit,
  flash,
}: {
  venueName: string
  onAudit: AuditFn
  flash: FlashFn
}) {
  const [name, setName] = useState(venueName)
  const [address, setAddress] = useState('Невский проспект, 88')
  const [phone, setPhone] = useState('+7 999 142-88-02')
  const [accent, setAccent] = useState('#B9FF66')

  return (
    <div className="page">
      <PageHead
        eyebrow="WHITE-LABEL"
        title="Оформление"
        sub="Бренд заведения и безопасный предпросмотр клиентского приложения"
        actions={
          <button
            className="btn"
            onClick={() => {
              onAudit('Оформление', `Бренд ${name} обновлён`)
              flash('Оформление сохранено только в demo admin')
            }}
          >
            <Save />Сохранить
          </button>
        }
      />

      <div className="brand-layout">
        <section className="card editor-card brand-form">
          <div className="card-title"><h3>Идентика</h3><Palette size={17} /></div>
          <div className="upload-area">
            <div className="brand-logo-preview">{name.slice(0, 1)}</div>
            <div>
              <b>Логотип заведения</b>
              <span>PNG, SVG или WEBP · до 4 МБ</span>
              <button className="btn secondary" onClick={() => flash('В демо-режиме файл не загружается')}>Загрузить</button>
            </div>
          </div>
          <Field label="Название заведения" value={name} onChange={setName} />
          <Field label="Адрес" value={address} onChange={setAddress} />
          <Field label="Телефон" value={phone} onChange={setPhone} />
          <label className="field">
            <span>Основной акцент</span>
            <div className="color-input">
              <input type="color" value={accent} onChange={(event) => setAccent(event.target.value)} />
              <input value={accent} onChange={(event) => setAccent(event.target.value)} />
            </div>
          </label>
          <div className="safety-note">
            <ShieldCheck />
            <span>В демо-режиме оформление клиентских приложений не изменяется.</span>
          </div>
        </section>

        <section className="card phone-preview-wrap">
          <span className="eyebrow">LIVE PREVIEW</span>
          <div className="phone-preview" style={{ '--preview-accent': accent } as CSSProperties}>
            <div className="phone-status"><span>21:41</span><span>••• 5G ▰</span></div>
            <div className="customer-cover">
              <div className="preview-logo">{name.slice(0, 1)}</div>
              <span>ПРОГРАММА ЛОЯЛЬНОСТИ</span>
              <h2>{name}</h2>
              <p>{address}</p>
            </div>
            <div className="balance-card">
              <span>Ваш баланс</span>
              <b>2 840 <small>бонусов</small></b>
              <div><span>Gold</span><span>10% кэшбэк</span></div>
            </div>
            <div className="preview-actions">
              <span><Gift />Колесо</span>
              <span><ShoppingBag />Магазин</span>
              <span><Trophy />Награды</span>
            </div>
            <div className="preview-progress">
              <span>До VIP</span><b>72%</b><i><em /></i>
            </div>
          </div>
          <small className="preview-caption">Предпросмотр · не изменяет текущий интерфейс гостей</small>
        </section>
      </div>
    </div>
  )
}

export function SettingsPage({ venueName, flash }: { venueName: string; flash: FlashFn }) {
  const [wheel, setWheel] = useState(true)
  const [shop, setShop] = useState(true)
  const [achievements, setAchievements] = useState(true)
  const [ownerEmail, setOwnerEmail] = useState('owner@example.demo')
  const [ownerPhone, setOwnerPhone] = useState('+7 999 142-88-02')
  const features = [
    ['Колесо', wheel, setWheel],
    ['Магазин', shop, setShop],
    ['Достижения', achievements, setAchievements],
  ] as const

  return (
    <div className="page">
      <PageHead
        eyebrow="СИСТЕМА"
        title="Настройки"
        sub={venueName}
        actions={<button className="btn" onClick={() => flash('Настройки demo сохранены')}><Save />Сохранить</button>}
      />
      <div className="settings-grid">
        <section className="card editor-card">
          <div className="card-title"><h3>Функции</h3></div>
          {features.map(([name, value, setter]) => (
            <div className="setting-row" key={name}>
              <div><b>{name}</b><span>Показывать модуль клиентам</span></div>
              <Toggle value={value} onChange={setter} />
            </div>
          ))}
        </section>
        <section className="card editor-card">
          <div className="card-title"><h3>Контакты</h3></div>
          <Field label="Email владельца" value={ownerEmail} onChange={setOwnerEmail} />
          <Field label="Телефон" value={ownerPhone} onChange={setOwnerPhone} />
          <div className="info-banner compact">
            <ShieldCheck />
            <span>Это демонстрационные настройки: изменения не сохраняются.</span>
          </div>
        </section>
      </div>
    </div>
  )
}
