import { describe, expect, it } from 'vitest'
import {
  assertTenantMutation, canAccessVenue, scopedCustomers,
  type Customer, type Session, type Venue,
} from '../domain'

const venueA: Venue = { id: 'va', companyId: 'ca', name: 'A', city: '', address: '', status: 'Активно' }
const venueB: Venue = { id: 'vb', companyId: 'cb', name: 'B', city: '', address: '', status: 'Активно' }
const adminA: Session = { id: 'a', name: 'Admin A', role: 'VENUE_ADMIN', companyIds: ['ca'] }
const superAdmin: Session = { id: 's', name: 'SA', role: 'SUPER_ADMIN', companyIds: [] }
const rows: Customer[] = [
  { id: '1', companyId: 'ca', venueId: 'va', name: 'A', initials: 'A', balance: 1, cashback: 5, level: 'Bronze', visits: 1, lifetimeSpend: 1, averageCheck: 1, lastVisit: '', platform: 'VK', status: 'Активен', registeredAt: '', earned: 1, redeemed: 0 },
  { id: '2', companyId: 'cb', venueId: 'vb', name: 'B', initials: 'B', balance: 1, cashback: 5, level: 'Bronze', visits: 1, lifetimeSpend: 1, averageCheck: 1, lastVisit: '', platform: 'TG', status: 'Активен', registeredAt: '', earned: 1, redeemed: 0 },
]

describe('tenant authorization', () => {
  it('Venue Admin A can access Venue A', () => expect(canAccessVenue(adminA, venueA)).toBe(true))
  it('Venue Admin A cannot read Venue B', () => expect(canAccessVenue(adminA, venueB)).toBe(false))
  it('changing venue_id cannot bypass scoped rows', () => expect(scopedCustomers(adminA, venueB, rows)).toEqual([]))
  it('Venue Admin A cannot mutate Venue B settings', () => expect(() => assertTenantMutation(adminA, venueB)).toThrow('TENANT_ACCESS_DENIED'))
  it('SUPER ADMIN can access both tenants', () => {
    expect(canAccessVenue(superAdmin, venueA)).toBe(true)
    expect(canAccessVenue(superAdmin, venueB)).toBe(true)
    expect(scopedCustomers(superAdmin, venueB, rows).map((row) => row.id)).toEqual(['2'])
  })
})
