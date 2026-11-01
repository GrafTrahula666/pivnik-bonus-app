// @vitest-environment node
import http from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { config } from '../config.js'
import { fixturePassword } from './onboarding-fixture.js'
import { tenantCrmFixture } from './tenant-crm-fixture.js'
import type { TenantCrmFixtureDatabase } from './tenant-crm-database-fixture.js'

// Independent cross-company security regression. Use the real HTTP router,
// signed sessions and separate fixture DBs. Do not read or mutate production.
const state = vi.hoisted(() => ({
  metadata: null as TenantCrmFixtureDatabase | null,
  targets: new Map<string, TenantCrmFixtureDatabase>(),
  targetResolutions: 0,
  targetQueries: 0,
}))

vi.mock('../db.js', () => {
  const execute = async (db: Pick<TenantCrmFixtureDatabase, 'query'>, text: string, params?: unknown[]) => {
    const result = await db.query(text, params)
    return { ...result, rowCount: result.rows.length || result.affectedRows || 0 }
  }
  const query = (text: string, params?: unknown[]) => execute(state.metadata!, text, params)
  const db = {
    query,
    connect: async () => {
      const connection = state.metadata!.connect
        ? await state.metadata!.connect()
        : { query: state.metadata!.query.bind(state.metadata!), release() {} }
      return {
        query: (text: string, params?: unknown[]) => execute(connection, text, params),
        release: () => connection.release(),
      }
    },
  }
  return { pool: db, readPool: db, writePool: null,
    tableExists: async () => false, productionTableExists: async () => false }
})

vi.mock('../onboarding-database-registry.js', () => {
  const registry = {
    validate: () => ({ registered: state.targets.size }),
    close: async () => {},
    async resolveTargetDatabase(key: string) {
      state.targetResolutions++
      const target = state.targets.get(key)
      if (!target) return null
      return {
        async connect() {
          const connection = target.connect
            ? await target.connect()
            : { query: target.query.bind(target), release() {} }
          return {
            release: () => connection.release(),
            async query(text: string, params?: unknown[]) {
              state.targetQueries++
              const result = await connection.query(text, params)
              return { ...result, rowCount: result.rows.length || result.affectedRows || 0 }
            },
          }
        },
      }
    },
  }
  return { onboardingTargetRegistry: registry,
    validateOnboardingTargetRegistry: registry.validate,
    closeOnboardingTargetRegistry: registry.close }
})

describe('CHAT 02 #13: reciprocal tenant CRM HTTP isolation', () => {
  let server: http.Server | undefined
  let origin = ''
  const cookies = new Map<string, string>()
  const databases: TenantCrmFixtureDatabase[] = []
  let drafts: string[] = []

  beforeAll(async () => {
    config.enableWrites = true
    config.enableOnboardingDrafts = true
    config.enableOnboardingInvitations = true
    config.enableTenantCrmReads = true
    config.publicOrigin = 'https://chat02-tenant-fixture.invalid'
    config.csrfSecret = 'chat02-test-only-tenant-isolation-secret'
    const fixture = await tenantCrmFixture()
    state.metadata = fixture.metadata
    databases.push(fixture.metadata, ...fixture.targets)
    drafts = fixture.manifests.map(manifest => manifest.source.draftId)
    for (const [key, value] of fixture.registry) state.targets.set(key, value)

    const { handleApi, sendApiError } = await import('../router.js')
    server = http.createServer((req, res) => {
      void handleApi(req, res, new URL(req.url!, origin)).catch(error => sendApiError(res, error, req))
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`

    for (const actor of ['owner', 'south']) {
      const response = await fetch(origin + '/api/admin/auth/login', {
        method: 'POST',
        headers: { origin: config.publicOrigin, 'content-type': 'application/json' },
        body: JSON.stringify({ email: actor + '@fixture.invalid', password: fixturePassword }),
      })
      expect(response.status).toBe(200)
      cookies.set(actor, response.headers.get('set-cookie')!.split(';')[0]!)
    }
  }, 90_000)

  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()))
    for (const db of databases) await db.close()
  })

  const get = (actor: string, endpoint: string) =>
    fetch(origin + endpoint, { headers: { cookie: cookies.get(actor)! } })
  const base = (index: number) => `/api/admin/onboarding/drafts/${drafts[index]}/crm`

  it('accepts own customer #1 but denies both directions of foreign draft/customer ID, before target lookup', async () => {
    // Identical numerical user IDs exist in physically distinct tenant databases.
    for (const [actor, index, balance] of [
      ['owner', 0, '101'], ['south', 2, '103'],
    ] as const) {
      const response = await get(actor, base(index) + '/customers/1')
      expect(response.status).toBe(200)
      const payload = await response.json()
      expect(payload).toMatchObject({ customer: { id: '1' }, wallet: { balance } })
    }

    for (const [actor, foreignIndex] of [
      ['owner', 2], ['south', 0], ['south', 1],
    ] as const) {
      for (const suffix of ['/customers/1', '/customers?q=Owned', '/readiness']) {
        const targetResolutions = state.targetResolutions
        const targetQueries = state.targetQueries
        const response = await get(actor, base(foreignIndex) + suffix)
        expect(response.status).toBe(404)
        const payload = await response.json()
        expect(payload).toMatchObject({ code: 'ONBOARDING_DRAFT_NOT_FOUND' })
        expect(JSON.stringify(payload)).not.toMatch(/Owned|9007199254740993|customer.*balance/i)
        expect(state.targetResolutions).toBe(targetResolutions)
        expect(state.targetQueries).toBe(targetQueries)
      }
    }
  })

  it('rejects forged company/venue scope even on an otherwise authorized own draft', async () => {
    for (const [actor, ownIndex, foreignCompany] of [
      ['owner', 0, '20'], ['south', 2, '10'],
    ] as const) {
      for (const suffix of [
        '/customers/1?companyId=' + foreignCompany,
        '/customers?companyId=' + foreignCompany,
        '/readiness?companyId=' + foreignCompany,
      ]) {
        const targetResolutions = state.targetResolutions
        const response = await get(actor, base(ownIndex) + suffix)
        expect(response.status).toBe(400)
        expect(state.targetResolutions).toBe(targetResolutions)
      }
    }
  })
})
