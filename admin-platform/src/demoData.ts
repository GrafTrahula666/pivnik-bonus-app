import type {
  Achievement, AuditEvent, Company, Customer, Promotion, ShopItem, Venue, WheelPrize,
} from './domain'

export const companies: Company[] = [
  { id: 'c-pivnik', name: 'ПИВНИК', status: 'Активна', venueIds: ['v-pivnik-center', 'v-pivnik-river'] },
  { id: 'c-north', name: 'NORTH BAR', status: 'Активна', venueIds: ['v-north'] },
  { id: 'c-mokka', name: 'MOKKA', status: 'Онбординг', venueIds: ['v-mokka'] },
  { id: 'c-brut', name: 'BRUT', status: 'Активна', venueIds: ['v-brut'] },
]

export const venues: Venue[] = [
  { id: 'v-pivnik-center', companyId: 'c-pivnik', name: 'ПИВНИК · Центр', city: 'Санкт-Петербург', address: 'Невский проспект, 88', status: 'Активно' },
  { id: 'v-pivnik-river', companyId: 'c-pivnik', name: 'ПИВНИК · Набережная', city: 'Санкт-Петербург', address: 'Петровская наб., 4', status: 'Активно' },
  { id: 'v-north', companyId: 'c-north', name: 'NORTH BAR', city: 'Москва', address: 'Покровка, 18', status: 'Активно' },
  { id: 'v-mokka', companyId: 'c-mokka', name: 'MOKKA Coffee', city: 'Казань', address: 'Баумана, 31', status: 'Активно' },
  { id: 'v-brut', companyId: 'c-brut', name: 'BRUT', city: 'Екатеринбург', address: 'Малышева, 44', status: 'Активно' },
]

const names = [
  'Анна Смирнова', 'Максим Волков', 'Екатерина Морозова', 'Алексей Орлов', 'Мария Соколова',
  'Илья Попов', 'Полина Лебедева', 'Дмитрий Кузнецов', 'София Новикова', 'Никита Фёдоров',
  'Дарья Павлова', 'Артём Васильев', 'Виктория Петрова', 'Роман Егоров', 'Алина Николаева',
  'Кирилл Захаров', 'Елена Медведева', 'Павел Алексеев', 'Ольга Романова', 'Денис Козлов',
  'Ксения Тихонова', 'Степан Беляев', 'Лиза Комарова', 'Влад Савельев',
]

export const customers: Customer[] = venues.flatMap((venue, venueIndex) =>
  Array.from({ length: 18 }, (_, index) => {
    const name = names[(index + venueIndex * 3) % names.length]
    const visits = 2 + ((index * 7 + venueIndex * 3) % 38)
    const averageCheck = 780 + ((index * 431 + venueIndex * 187) % 2900)
    const lifetimeSpend = visits * averageCheck
    const cashback = [5, 7, 10, 15][(index + venueIndex) % 4]
    const earned = Math.round(lifetimeSpend * cashback / 100)
    const redeemed = Math.round(earned * (0.35 + ((index % 5) / 10)))
    return {
      id: `${venue.id}-u-${index + 1}`,
      companyId: venue.companyId,
      venueId: venue.id,
      name,
      initials: name.split(' ').map((part) => part[0]).join(''),
      balance: earned - redeemed + 200,
      cashback,
      level: ['Bronze', 'Silver', 'Gold', 'VIP'][(index + venueIndex) % 4],
      visits,
      lifetimeSpend,
      averageCheck,
      lastVisit: `${String(28 - (index % 20)).padStart(2, '0')}.08.2026`,
      platform: ['VK', 'TG', 'VK + TG'][(index + venueIndex) % 3] as Customer['platform'],
      status: ['Активен', 'Активен', 'Новый', 'Спит'][(index + venueIndex) % 4] as Customer['status'],
      registeredAt: `${String(1 + (index % 27)).padStart(2, '0')}.${String(1 + ((index + venueIndex) % 8)).padStart(2, '0')}.2026`,
      earned,
      redeemed,
    }
  }),
)

export function makeSeries(seed = 0) {
  return Array.from({ length: 90 }, (_, index) => {
    const wave = Math.sin((index + seed) / 5) * 15000
    const trend = index * 620
    const revenue = Math.round(
      98000 + wave + trend + ((index * 7919 + seed * 313) % 22000),
    )
    const visits = Math.round(revenue / (1480 + ((index + seed) % 5) * 45))
    return {
      day: `${String((index % 30) + 1).padStart(2, '0')}.${String(6 + Math.floor(index / 30)).padStart(2, '0')}`,
      revenue,
      previous: Math.round(revenue * (0.82 + ((index % 7) * 0.018))),
      visits,
      customers: Math.round(visits * 0.82),
      bonuses: Math.round(revenue * 0.072),
    }
  })
}

export const wheelPrizes: WheelPrize[] = [
  { id: 'wp1', title: '100 бонусов', probability: 34, rewardType: 'bonus', value: 100, inventory: null, enabled: true },
  { id: 'wp2', title: '300 бонусов', probability: 20, rewardType: 'bonus', value: 300, inventory: null, enabled: true },
  { id: 'wp3', title: 'Кофе в подарок', probability: 15, rewardType: 'item', value: 1, inventory: 84, enabled: true },
  { id: 'wp4', title: 'Повторный шанс', probability: 20, rewardType: 'retry', value: 1, inventory: null, enabled: true },
  { id: 'wp5', title: '1000 бонусов', probability: 7, rewardType: 'bonus', value: 1000, inventory: 24, enabled: true },
  { id: 'wp6', title: 'Секретный приз', probability: 4, rewardType: 'item', value: 1, inventory: 9, enabled: true },
]

export const shopItems: ShopItem[] = [
  { id: 's1', title: 'Фирменный бокал', category: 'Мерч', price: 1600, stock: 34, enabled: true, description: 'Коллекционный бокал с логотипом заведения.' },
  { id: 's2', title: 'Кофе за бонусы', category: 'Напитки', price: 650, stock: 120, enabled: true, description: 'Любой классический кофе до 350 мл.' },
  { id: 's3', title: 'Бургер Signature', category: 'Еда', price: 2200, stock: 47, enabled: true, description: 'Фирменная позиция кухни за бонусы.' },
  { id: 's4', title: 'Шоппер', category: 'Мерч', price: 2600, stock: 8, enabled: true, description: 'Плотный хлопковый шоппер лимитированной серии.' },
  { id: 's5', title: 'Сет на двоих', category: 'Еда', price: 4800, stock: 15, enabled: false, description: 'Специальный сет для участников программы.' },
  { id: 's6', title: 'VIP frame', category: 'Digital', price: 3200, stock: 999, enabled: true, description: 'Эксклюзивная рамка профиля на 30 дней.' },
]

export const promotions: Promotion[] = [
  { id: 'p1', name: 'Двойной кэшбэк по средам', start: '02.09.2026', end: '30.09.2026', mechanic: 'x2 cashback', reward: 'до 14%', enabled: true },
  { id: 'p2', name: 'Welcome Week', start: '01.09.2026', end: '07.09.2026', mechanic: 'registration', reward: '+500 бонусов', enabled: true },
  { id: 'p3', name: 'Ночной гость', start: '12.09.2026', end: '13.09.2026', mechanic: 'time window', reward: '+7% cashback', enabled: false },
]

export const achievements: Achievement[] = [
  { id: 'a1', title: 'Первый раунд', description: 'Сделать первый визит', rarity: 'Обычное', condition: 'visits ≥ 1', reward: '100 бонусов', enabled: true, hidden: false, unlocked: 842 },
  { id: 'a2', title: 'Завсегдатай', description: '10 посещений', rarity: 'Редкое', condition: 'visits ≥ 10', reward: '500 бонусов', enabled: true, hidden: false, unlocked: 319 },
  { id: 'a3', title: 'Легенда бара', description: '50 посещений', rarity: 'Легендарное', condition: 'visits ≥ 50', reward: 'VIP frame', enabled: true, hidden: true, unlocked: 41 },
  { id: 'a4', title: 'Исследователь', description: 'Попробовать 5 наград', rarity: 'Эпическое', condition: 'rewards ≥ 5', reward: '1000 бонусов', enabled: true, hidden: false, unlocked: 86 },
]

export const auditSeed: AuditEvent[] = [
  { id: 'e1', admin: 'Алексей · Владелец', companyId: 'c-pivnik', venueId: 'v-pivnik-center', action: 'Изменил', entity: 'Лояльность', summary: 'Базовый кэшбэк 5% → 7%', timestamp: '29.08.2026 · 02:41' },
  { id: 'e2', admin: 'Мария · Админ', companyId: 'c-pivnik', venueId: 'v-pivnik-center', action: 'Начислила', entity: 'Клиент', summary: '+500 бонусов · Анна Смирнова', timestamp: '28.08.2026 · 19:12' },
  { id: 'e3', admin: 'Platform Admin', companyId: 'c-north', venueId: 'v-north', action: 'Изменил', entity: 'Колесо', summary: 'Вероятность «1000 бонусов» 5% → 7%', timestamp: '28.08.2026 · 15:03' },
  { id: 'e4', admin: 'Platform Admin', companyId: 'c-mokka', venueId: 'v-mokka', action: 'Включил', entity: 'Акция', summary: 'Welcome Week', timestamp: '28.08.2026 · 10:18' },
  { id: 'e5', admin: 'Алексей · Владелец', companyId: 'c-pivnik', venueId: 'v-pivnik-river', action: 'Обновил', entity: 'Магазин', summary: 'Остаток «Шоппер» 11 → 8', timestamp: '27.08.2026 · 22:07' },
]
