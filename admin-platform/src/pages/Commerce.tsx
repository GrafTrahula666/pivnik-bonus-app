import { useState } from 'react'
import {
  AlertTriangle, Coins, Pencil, Plus, ShieldCheck, ShoppingBag, TicketPercent, TrendingUp,
} from 'lucide-react'
import { promotions as promotionSeed, shopItems as shopSeed } from '../demoData'
import type { Promotion, ShopItem } from '../domain'
import { EditorModal, Field, PageHead, Status, Toggle, cn, rub } from '../ui'

type AuditFn = (entity: string, summary: string) => void
type FlashFn = (text: string) => void

export function ShopPage({ onAudit, flash }: { onAudit: AuditFn; flash: FlashFn }) {
  const [items, setItems] = useState<ShopItem[]>(shopSeed)
  const [view, setView] = useState<'cards' | 'table'>('cards')
  const [edit, setEdit] = useState<ShopItem | null>(null)

  function move(id: string, direction: -1 | 1) {
    setItems((current) => {
      const index = current.findIndex((item) => item.id === id)
      const nextIndex = index + direction
      if (nextIndex < 0 || nextIndex >= current.length) return current
      const next = [...current]
      ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
      return next
    })
  }

  return (
    <div className="page">
      <PageHead
        eyebrow="CMS"
        title="Магазин"
        sub="Каталог наград, остатки и стоимость в бонусах"
        actions={
          <>
            <div className="segmented">
              <button className={view === 'cards' ? 'active' : ''} onClick={() => setView('cards')}>Карточки</button>
              <button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}>Таблица</button>
            </div>
            <button
              className="btn"
              onClick={() => setEdit({
                id: crypto.randomUUID(), title: '', category: 'Мерч', price: 500,
                stock: 10, enabled: true, description: '',
              })}
            >
              <Plus />Товар
            </button>
          </>
        }
      />

      <div className="summary-strip card">
        <div><ShoppingBag /><span>Покупок · 30д</span><b>638</b></div>
        <div><Coins /><span>Потрачено бонусов</span><b>1,24 млн</b></div>
        <div><TrendingUp /><span>Конверсия каталога</span><b>12,8%</b></div>
        <div className="warning"><AlertTriangle /><span>Мало на складе</span><b>2 товара</b></div>
      </div>

      {view === 'cards' ? (
        <div className="shop-grid">
          {items.map((item, index) => (
            <article className="product-card card" key={item.id}>
              <div className={cn('product-art', `art-${index % 4}`)}>
                <ShoppingBag /><span>{item.category}</span>
                <button className="icon-btn" onClick={() => setEdit(item)}><Pencil /></button>
              </div>
              <div className="product-body">
                <div><h3>{item.title}</h3><Status value={item.enabled ? 'Активен' : 'Пауза'} /></div>
                <p>{item.description}</p>
                <div className="product-price">
                  <strong>{rub.format(item.price)} <small>бонусов</small></strong>
                  <span>Остаток · {item.stock}</span>
                </div>
                <div className="reorder">
                  <button disabled={index === 0} onClick={() => move(item.id, -1)}>↑ Выше</button>
                  <button disabled={index === items.length - 1} onClick={() => move(item.id, 1)}>↓ Ниже</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="table-card card">
          <div className="table-scroll">
            <table>
              <thead><tr><th>Товар</th><th>Категория</th><th>Цена</th><th>Остаток</th><th>Статус</th><th /></tr></thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td><b>{item.title}</b></td><td>{item.category}</td><td>{rub.format(item.price)}</td><td>{item.stock}</td>
                    <td><Status value={item.enabled ? 'Активен' : 'Пауза'} /></td>
                    <td><button className="ghost-icon" onClick={() => setEdit(item)}><Pencil /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {edit && (
        <EditorModal
          title={edit.id.startsWith('s') ? 'Редактировать товар' : 'Новый товар'}
          onCancel={() => setEdit(null)}
          onSave={() => {
            setItems((current) => current.some((item) => item.id === edit.id)
              ? current.map((item) => item.id === edit.id ? edit : item)
              : [edit, ...current])
            onAudit('Магазин', `${edit.title || 'Новый товар'} · сохранено`)
            flash('Товар сохранён')
            setEdit(null)
          }}
        >
          <Field label="Название" value={edit.title} onChange={(value) => setEdit({ ...edit, title: value })} />
          <Field label="Категория" value={edit.category} onChange={(value) => setEdit({ ...edit, category: value })} />
          <Field label="Цена, бонусов" value={edit.price} type="number" onChange={(value) => setEdit({ ...edit, price: +value })} />
          <Field label="Остаток" value={edit.stock} type="number" onChange={(value) => setEdit({ ...edit, stock: +value })} />
          <Field label="Описание" value={edit.description} onChange={(value) => setEdit({ ...edit, description: value })} />
          <div className="setting-row"><span>Товар активен</span><Toggle value={edit.enabled} onChange={(value) => setEdit({ ...edit, enabled: value })} /></div>
        </EditorModal>
      )}
    </div>
  )
}

export function PromotionsPage({ onAudit, flash }: { onAudit: AuditFn; flash: FlashFn }) {
  const [items, setItems] = useState<Promotion[]>(promotionSeed)
  const [edit, setEdit] = useState<Promotion | null>(null)

  return (
    <div className="page">
      <PageHead
        eyebrow="МАРКЕТИНГ"
        title="Акции"
        sub="Запланированные механики без отправки сообщений"
        actions={
          <button
            className="btn"
            onClick={() => setEdit({
              id: crypto.randomUUID(), name: '', start: '01.09.2026', end: '07.09.2026',
              mechanic: 'cashback', reward: '+5%', enabled: false,
            })}
          >
            <Plus />Создать акцию
          </button>
        }
      />
      <div className="promo-grid">
        {items.map((item, index) => (
          <article className="promo-card card" key={item.id}>
            <div className={cn('promo-visual', `promo-${index}`)}><TicketPercent /><span>{item.mechanic}</span></div>
            <div className="promo-body">
              <div><Status value={item.enabled ? 'Активен' : 'Пауза'} /><button className="ghost-icon" onClick={() => setEdit(item)}><Pencil /></button></div>
              <h3>{item.name}</h3><p>{item.start} → {item.end}</p><strong>{item.reward}</strong>
              <div className="promo-metrics">
                <span>Охват <b>{[1480, 926, 0][index] ?? 0}</b></span>
                <span>Конверсия <b>{[18.4, 22.1, 0][index] ?? 0}%</b></span>
              </div>
            </div>
          </article>
        ))}
      </div>
      <div className="info-banner">
        <ShieldCheck />
        <div><b>Рассылки пока не подключены</b><span>Экран подготовлен к будущему модулю доставки. В Phase A акции управляют только локальной demo-конфигурацией.</span></div>
      </div>

      {edit && (
        <EditorModal
          title="Редактор акции"
          onCancel={() => setEdit(null)}
          onSave={() => {
            setItems((current) => current.some((item) => item.id === edit.id)
              ? current.map((item) => item.id === edit.id ? edit : item)
              : [edit, ...current])
            onAudit('Акция', `${edit.name || 'Новая'} · сохранено`)
            flash('Акция сохранена')
            setEdit(null)
          }}
        >
          <Field label="Название" value={edit.name} onChange={(value) => setEdit({ ...edit, name: value })} />
          <div className="form-grid two">
            <Field label="Старт" value={edit.start} onChange={(value) => setEdit({ ...edit, start: value })} />
            <Field label="Завершение" value={edit.end} onChange={(value) => setEdit({ ...edit, end: value })} />
          </div>
          <Field label="Механика" value={edit.mechanic} onChange={(value) => setEdit({ ...edit, mechanic: value })} />
          <Field label="Награда / множитель" value={edit.reward} onChange={(value) => setEdit({ ...edit, reward: value })} />
          <div className="setting-row"><span>Включена</span><Toggle value={edit.enabled} onChange={(value) => setEdit({ ...edit, enabled: value })} /></div>
        </EditorModal>
      )}
    </div>
  )
}
