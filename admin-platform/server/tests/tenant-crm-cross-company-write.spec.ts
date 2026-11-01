// @vitest-environment node
import crypto from 'node:crypto'
import http from 'node:http'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { config } from '../config.js'
import { fixturePassword, seedOnboardingFixture } from './onboarding-fixture.js'

// CHАT 02 #14: real HTTP session + isolated SQL metadata; no live service or money writer.
const state = vi.hoisted(() => ({ db: null as PGlite | null }))
vi.mock('../db.js', () => {
  const query = async (sql: string, params?: unknown[]) => {
    const result = await state.db!.query(sql, params)
    return { ...result, rowCount: result.rows.length || result.affectedRows || 0 }
  }
  const adapter = { query, connect: async () => ({ query, release() {} }) }
  return { pool: adapter, readPool: adapter, writePool: null,
    tableExists: async () => false, productionTableExists: async () => false }
})

describe('CHAT 02 #14: foreign-company CRM mutations fail closed over signed HTTP', () => {
  let server: http.Server | undefined
  let origin = ''
  const sessions = new Map<string, { cookie: string; csrf: string }>()
  const drafts = new Map<string, string>()
  const initialConfig = {
    enableWrites: config.enableWrites,
    enableOnboardingDrafts: config.enableOnboardingDrafts,
    enableOnboardingInvitations: config.enableOnboardingInvitations,
    publicOrigin: config.publicOrigin,
    csrfSecret: config.csrfSecret,
  }
  const appConfig = { displayName: 'Fixture CRM', theme: 'premium-dark',
    primaryColor: '#73bcd9', secondaryColor: '#172c36', shopEnabled: false, loyaltyEnabled: true }
  const details = (companyId: string) => ({
    companyId, companyName: '', venueName: 'Fixture venue',
    address: '', timeZone: 'Europe/Moscow', venueType: 'cafe', ownerEmail: '',
  })

  beforeAll(async () => {
    config.enableWrites = true
    config.enableOnboardingDrafts = true
    config.enableOnboardingInvitations = true
    config.publicOrigin = 'https://chat02-write-fixture.invalid'
    config.csrfSecret = 'chat02-only-fixture-csrf-secret-1234567890'

    state.db = await seedOnboardingFixture(new PGlite())
    const hash = (await state.db.query<{ password_hash: string }>(
      'SELECT password_hash FROM admin_accounts WHERE id=11')).rows[0]!.password_hash
    await state.db.query(
      "INSERT INTO admin_accounts(id,email,display_name,role,password_hash) VALUES(21,'south@fixture.invalid','South','VENUE_ADMIN',$1)",
      [hash],
    )
    await state.db.exec("INSERT INTO admin_company_access(admin_id,company_id,access_kind) VALUES(21,20,'owner')")

    for (const companyId of ['10', '20']) {
      const draftId = crypto.randomUUID()
      drafts.set(companyId, draftId)
      await state.db.query(
        'INSERT INTO admin_onboarding_drafts(id,admin_id,company_id,request_key,initial_hash,data) VALUES($1,1,$2,$3,$4,$5)',
        [draftId, companyId, crypto.randomUUID(), 'a'.repeat(64), JSON.stringify(details(companyId))],
      )
      await state.db.query(
        'INSERT INTO admin_onboarding_app_configs(draft_id,tenant_key,config) VALUES($1,$2,$3)',
        [draftId, 'sv-' + draftId.replaceAll('-', ''), JSON.stringify(appConfig)],
      )
    }

    const { handleApi, sendApiError } = await import('../router.js')
    server = http.createServer((req, res) => {
      void handleApi(req, res, new URL(req.url!, origin)).catch(error => sendApiError(res, error, req))
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    origin = 'http://127.0.0.1:' + (server.address() as import('node:net').AddressInfo).port

    for (const actor of ['owner', 'south']) {
      const response = await fetch(origin + '/api/admin/auth/login', {
        method: 'POST',
        headers: { origin: config.publicOrigin, 'content-type': 'application/json' },
        body: JSON.stringify({ email: actor + '@fixture.invalid', password: fixturePassword }),
      })
      expect(response.status).toBe(200)
      const body = await response.json() as { csrfToken: string }
      sessions.set(actor, { cookie: response.headers.get('set-cookie')!.split(';')[0]!,
        csrf: body.csrfToken })
    }
  }, 90_000)

  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()))
    await state.db?.close()
    Object.assign(config, initialConfig)
  })

  async function request(actor: string, method: string, path: string, body: unknown = {}) {
    const session = sessions.get(actor)!
    return fetch(origin + path, {
      method,
      headers: { cookie: session.cookie, origin: config.publicOrigin,
        'x-csrf-token': session.csrf, 'content-type': 'application/json' },
      ...(method === 'GET' || method === 'DELETE' ? {} : { body: JSON.stringify(body) }),
    })
  }
  async function snapshot() {
    const [drafts, apps, wallets, transactions] = await Promise.all([
      state.db!.query('SELECT id::text,revision,data FROM admin_onboarding_drafts ORDER BY id'),
      state.db!.query('SELECT draft_id::text,revision,config FROM admin_onboarding_app_configs ORDER BY draft_id'),
      state.db!.query('SELECT id,balance FROM wallets ORDER BY id'),
      state.db!.query('SELECT id,amount FROM transactions ORDER BY id'),
    ])
    return { drafts: drafts.rows, apps: apps.rows, wallets: wallets.rows, transactions: transactions.rows }
  }

  it('provides two positive session/ownership controls before testing writes', async () => {
    for (const [actor, expected, forbidden] of [
      ['owner', ['1', '2'], '3'], ['south', ['3'], '1'],
    ] as const) {
      const response = await request(actor, 'GET', '/api/admin/venues')
      expect(response.status).toBe(200)
      const list = (await response.json() as { venues: Array<{ id: string }> }).venues
      expect(list.map(venue => venue.id)).toEqual(expected)
      expect(list.some(venue => venue.id === forbidden)).toBe(false)
    }
  })

  it('denies foreign venue CRM mutations both ways before any metadata/money changes', async () => {
    const before = await snapshot()
    const writes: Array<[string, string, unknown]> = [
      ['POST', 'clients/1/bonus-adjustments',
        { type: 'credit', amount: 10, reason: 'Fixture only', idempotencyKey: 'chat02-fixture-14' }],
      ['POST', 'clients/1/entitlements', { entitlement: 'fixture' }],
      ['PUT', 'clients/1/cashback', { cashbackPercent: 5 }],
      ['POST', 'clients/1/achievements/grant', { achievementCode: 'fixture' }],
      ['POST', 'clients/1/app-achievements', { achievementCode: 'fixture' }],
      ['POST', 'clients/1/frames', { frameCode: 'fixture' }],
      ['DELETE', 'clients/1/frames/fixture', {}],
    ]
    for (const [actor, foreignVenue] of [['owner', '3'], ['south', '1']] as const) {
      for (const [method, action, body] of writes) {
        const response = await request(actor, method, '/api/admin/venues/' + foreignVenue + '/' + action, body)
        expect(response.status).toBe(404)
        expect(await response.json()).toMatchObject({ code: 'VENUE_NOT_FOUND' })
      }
    }
    expect(await snapshot()).toEqual(before)
  })

  it('denies foreign onboarding CRM metadata updates in both directions without mutating rows', async () => {
    const before = await snapshot()
    for (const [actor, foreignCompany] of [['owner', '20'], ['south', '10']] as const) {
      const target = '/api/admin/onboarding/drafts/' + drafts.get(foreignCompany)!
      const attempts: Array<[string, unknown]> = [
        ['', { revision: 1, data: { ...details(foreignCompany), venueName: 'UNAUTHORIZED' } }],
        ['/application', { revision: 1, config: { ...appConfig, displayName: 'UNAUTHORIZED' } }],
      ]
      for (const [suffix, body] of attempts) {
        const response = await request(actor, 'PUT', target + suffix, body)
        expect(response.status).toBe(404)
        expect(await response.json()).toMatchObject({ code: 'ONBOARDING_DRAFT_NOT_FOUND' })
      }
    }
    expect(await snapshot()).toEqual(before)
  })
})
