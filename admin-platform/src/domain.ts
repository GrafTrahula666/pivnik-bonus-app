export type AdminRole = 'SUPER_ADMIN' | 'VENUE_ADMIN'

export interface Session {
  id: string
  name: string
  role: AdminRole
  companyIds: string[]
}

export interface Company {
  id: string
  name: string
  status: 'Активна' | 'Онбординг' | 'Пауза'
  venueIds: string[]
}

export interface Venue {
  id: string
  companyId: string
  name: string
  city: string
  address: string
  status: 'Активно' | 'Пауза'
}

export interface Customer {
  id: string
  companyId: string
  venueId: string
  name: string
  initials: string
  balance: number
  cashback: number
  level: string
  visits: number
  lifetimeSpend: number
  averageCheck: number
  lastVisit: string
  platform: 'VK' | 'TG' | 'VK + TG'
  status: 'Активен' | 'Спит' | 'Новый'
  registeredAt: string
  earned: number
  redeemed: number
}

export interface LoyaltyLevel {
  id: string
  name: string
  threshold: number
  cashback: number
  enabled: boolean
}

export interface WheelPrize {
  id: string
  title: string
  probability: number
  rewardType: 'bonus' | 'item' | 'retry'
  value: number
  inventory: number | null
  enabled: boolean
}

export interface ShopItem {
  id: string
  title: string
  category: string
  price: number
  stock: number
  enabled: boolean
  description: string
}

export interface Promotion {
  id: string
  name: string
  start: string
  end: string
  mechanic: string
  reward: string
  enabled: boolean
}

export interface Achievement {
  id: string
  title: string
  description: string
  rarity: 'Обычное' | 'Редкое' | 'Эпическое' | 'Легендарное'
  condition: string
  reward: string
  enabled: boolean
  hidden: boolean
  unlocked: number
}

export interface AuditEvent {
  id: string
  admin: string
  companyId: string
  venueId: string
  action: string
  entity: string
  summary: string
  timestamp: string
}

export function canAccessVenue(session: Session, venue: Venue): boolean {
  return session.role === 'SUPER_ADMIN' || session.companyIds.includes(venue.companyId)
}

export function scopedCustomers(session: Session, venue: Venue, customers: Customer[]): Customer[] {
  if (!canAccessVenue(session, venue)) return []
  return customers.filter(
    (customer) => customer.venueId === venue.id && customer.companyId === venue.companyId,
  )
}

export function assertTenantMutation(session: Session, venue: Venue): void {
  if (!canAccessVenue(session, venue)) throw new Error('TENANT_ACCESS_DENIED')
}

export function wheelProbabilityTotal(prizes: WheelPrize[]): number {
  return prizes.filter((prize) => prize.enabled).reduce((sum, prize) => sum + prize.probability, 0)
}

export function validateLevels(levels: LoyaltyLevel[]): string[] {
  const enabled = levels.filter((level) => level.enabled)
  const errors: string[] = []
  if (enabled.some((level) => level.threshold < 0)) errors.push('Порог не может быть отрицательным')
  if (enabled.some((level) => level.cashback < 0 || level.cashback > 100)) {
    errors.push('Кэшбэк должен быть от 0 до 100%')
  }
  for (let index = 1; index < enabled.length; index += 1) {
    if (enabled[index].threshold <= enabled[index - 1].threshold) {
      errors.push('Пороги уровней должны возрастать')
    }
  }
  return [...new Set(errors)]
}
