// @vitest-environment node
import { readFile } from 'node:fs/promises'
import type { Pool } from 'pg'
import { afterEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { config } from '../config.js'
import { getAiEntitlementStatus, requireAiEntitlement } from '../ai-entitlement.js'
import type { AdminPrincipal, VenueScope } from '../types.js'

const owner: AdminPrincipal = { id: '11', role: 'VENUE_ADMIN', email: 'owner@fixture.invalid', displayName: 'Owner' }
const trusted: AdminPrincipal = { id: '12', role: 'VENUE_ADMIN', email: 'trusted@fixture.invalid', displayName: 'Trusted' }
const otherOwner: AdminPrincipal = { id: '13', role: 'VENUE_ADMIN', email: 'other@fixture.invalid', displayName: 'Other' }
const superAdmin: AdminPrincipal = { id: '1', role: 'SUPER_ADMIN', email: 'root@fixture.invalid', displayName: 'Root' }
const venue: VenueScope = { id: '101', companyId: '10', companyCode: 'a', companyName: 'A', code: 'a', name: 'A', address: null, legacyBarId: null }
const otherVenue: VenueScope = { ...venue, id: '201', companyId: '20', companyCode: 'b', companyName: 'B' }
const now = new Date('2026-11-01T12:00:00.000Z')
const dbAsPool = (db: PGlite) => db as unknown as Pick<Pool, 'query'>

async function fixture(withMigration = true): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(`CREATE TABLE companies(id BIGINT PRIMARY KEY, active BOOLEAN NOT NULL);
    CREATE TABLE venues(id BIGINT PRIMARY KEY,company_id BIGINT NOT NULL REFERENCES companies(id),active BOOLEAN NOT NULL);
    CREATE TABLE admin_accounts(id BIGINT PRIMARY KEY,role TEXT NOT NULL,active BOOLEAN NOT NULL);
    CREATE TABLE admin_company_access(admin_id BIGINT,company_id BIGINT,access_kind TEXT NOT NULL);
    INSERT INTO companies VALUES(10,TRUE),(20,TRUE);
    INSERT INTO venues VALUES(101,10,TRUE),(102,10,TRUE),(201,20,TRUE);
    INSERT INTO admin_accounts VALUES(1,'SUPER_ADMIN',TRUE),(11,'VENUE_ADMIN',TRUE),
      (12,'VENUE_ADMIN',TRUE),(13,'VENUE_ADMIN',TRUE);
    INSERT INTO admin_company_access VALUES(11,10,'owner'),(12,10,'trusted'),(13,20,'owner');`)
  if (withMigration) {
    await db.exec(await readFile(new URL('../../admin-migrations/027_ai_entitlements.sql', import.meta.url), 'utf8'))
  }
  return db
}

async function grant(db: PGlite, venueId = '101', expiry = '2026-11-10T12:00:00.000Z'): Promise<void> {
  await db.query(`INSERT INTO admin_ai_entitlements
    (venue_id,state,enabled,approved_at,expires_at,approval_reference)
    VALUES($1,'active',TRUE,'2026-10-01T00:00:00Z',$2,'approved-fixture-only')`, [venueId, expiry])
}

describe('CHAT 14 / 133: independent AI entitlement (never a CRM or guest reward)', () => {
  const oldFlag = config.enableAi
  afterEach(() => { config.enableAi = oldFlag })

  it('starts with the platform AI flag disabled', () => {
    expect(oldFlag).toBe(false)
  })

  it('rejects without querying the database while global AI is off', async () => {
    config.enableAi = false
    const noDb = { query: () => { throw new Error('DB must never be used') } } as unknown as Pick<Pool, 'query'>
    const state = await getAiEntitlementStatus(noDb, owner, venue, now)
    expect(state).toEqual({ enabled: false, status: 'not_configured', code: 'AI_PLATFORM_DISABLED' })
    await expect(requireAiEntitlement(noDb, owner, venue, now))
      .rejects.toMatchObject({ statusCode: 403, code: 'AI_ENTITLEMENT_REQUIRED' })
  })

  it('fails closed when the manual schema has not been applied', async () => {
    config.enableAi = true
    const db = await fixture(false)
    try {
      expect(await getAiEntitlementStatus(dbAsPool(db), owner, venue, now)).toMatchObject({
        enabled: false, status: 'not_configured', code: 'AI_ENTITLEMENT_SCHEMA_MISSING',
      })
    } finally { await db.close() }
  })

  it('creates NO activation rows, has FALSE default and rejects unapproved activation', async () => {
    config.enableAi = true
    const db = await fixture()
    try {
      expect(await getAiEntitlementStatus(dbAsPool(db), owner, venue, now))
        .toMatchObject({ enabled: false, code: 'AI_ENTITLEMENT_NOT_CONFIGURED' })
      await db.query('INSERT INTO admin_ai_entitlements(venue_id) VALUES(101)')
      const state = await db.query<{ enabled: boolean, state: string }>(
        'SELECT enabled,state FROM admin_ai_entitlements WHERE venue_id=101')
      expect(state.rows[0]).toEqual({ enabled: false, state: 'not_configured' })
      await expect(db.query(`UPDATE admin_ai_entitlements SET enabled=TRUE,state='active'
        WHERE venue_id=101`)).rejects.toThrow()
      expect((await getAiEntitlementStatus(dbAsPool(db), owner, venue, now)).enabled).toBe(false)
    } finally { await db.close() }
  })

  it('allows only a live owner with an explicit approved non-expired row and feature flag', async () => {
    config.enableAi = true
    const db = await fixture()
    try {
      await grant(db)
      expect(await getAiEntitlementStatus(dbAsPool(db), owner, venue, now)).toEqual({
        enabled: true, status: 'active', code: 'AI_ENTITLEMENT_ACTIVE',
      })
      await expect(requireAiEntitlement(dbAsPool(db), owner, venue, now)).resolves.toBeUndefined()
      expect((await getAiEntitlementStatus(dbAsPool(db), owner, { ...venue, id: '102' }, now)).enabled).toBe(false)
      config.enableAi = false
      expect((await getAiEntitlementStatus(dbAsPool(db), owner, venue, now)).enabled).toBe(false)
    } finally { await db.close() }
  })

  it('refuses trusted directors, unrelated companies and forged canonical scope', async () => {
    config.enableAi = true
    const db = await fixture()
    try {
      await grant(db)
      await grant(db, '201')
      for (const [admin, selected] of [
        [trusted, venue],
        [otherOwner, venue],
        [owner, otherVenue],
        [owner, { ...venue, companyId: '20' }],
        [owner, { ...venue, id: '101 OR 1=1' }],
      ] as Array<[AdminPrincipal, VenueScope]>) {
        const status = await getAiEntitlementStatus(dbAsPool(db), admin, selected, now)
        expect(status.enabled).toBe(false)
        expect(['forbidden', 'unavailable']).toContain(status.status)
      }
      expect((await getAiEntitlementStatus(dbAsPool(db), otherOwner, otherVenue, now)).enabled).toBe(true)
      expect((await getAiEntitlementStatus(dbAsPool(db), superAdmin, venue, now)).enabled).toBe(true)
    } finally { await db.close() }
  })

  it('fails closed after permission revoke or account deactivation', async () => {
    config.enableAi = true
    const db = await fixture()
    try {
      await grant(db)
      await db.query("UPDATE admin_company_access SET access_kind='trusted' WHERE admin_id=11")
      expect((await getAiEntitlementStatus(dbAsPool(db), owner, venue, now)).enabled).toBe(false)
      await db.query("UPDATE admin_company_access SET access_kind='owner' WHERE admin_id=11")
      await db.query('UPDATE admin_accounts SET active=FALSE WHERE id=11')
      expect((await getAiEntitlementStatus(dbAsPool(db), owner, venue, now)).enabled).toBe(false)
    } finally { await db.close() }
  })

  it('rejects expired, suspended and corrupted evidence and database failures', async () => {
    config.enableAi = true
    const db = await fixture()
    try {
      await grant(db, '101', '2026-10-15T00:00:00Z')
      expect(await getAiEntitlementStatus(dbAsPool(db), owner, venue, now))
        .toMatchObject({ enabled: false, status: 'expired' })
      await db.query("UPDATE admin_ai_entitlements SET enabled=FALSE,state='suspended' WHERE venue_id=101")
      expect((await getAiEntitlementStatus(dbAsPool(db), owner, venue, now)).enabled).toBe(false)
    } finally { await db.close() }
    const broken = { query: async () => { throw new Error('synthetic database outage with secret') } } as unknown as Pick<Pool, 'query'>
    const denied = await getAiEntitlementStatus(broken, owner, venue, now)
    expect(denied).toEqual({ enabled: false, status: 'unavailable', code: 'AI_ENTITLEMENT_CHECK_FAILED' })
    expect(JSON.stringify(denied)).not.toContain('secret')
  })
})
