// @vitest-environment node
import http from 'node:http'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// CHAT 02 #14: real signed HTTP requests, two independent company owners,
// disposable metadata only. The production writer must never be reached.
const state = vi.hoisted(() => ({ db: null as PGlite | null, writerConnects: 0 }))
vi.mock('../db.js', () => {
  const query = async (sql: string, params?: unknown[]) => {
    const result = await state.db!.query(sql, params)
    return { ...result, rowCount: result.rows.length || result.affectedRows || 0 }
  }
  const metadata = { query, connect: async () => ({ query, release() {} }) }
  return {
    pool: metadata, readPool: metadata,
    writePool: { connect: async () => {
      state.writerConnects++
      throw new Error('Unexpected production writer connection in tenant isolation fixture')
    } },
    productionTableExists: async () => false,
    tableExists: async () => false,
  }
})

describe('CHAT 02 #14: reciprocal cross-company CRM mutation denial', () => {
  let server: http.Server | undefined
  let origin = ''
  const publicOrigin = 'https://chat02-mutation-fixture.invalid'
  const password = 'Fixture-Tenant-Mutation-2026!'
  const sessions = new Map<string, { cookie: string; csrf: string }>()

  beforeAll(async () => {
    process.env.ADMIN_ENABLE_WRITES = 'false'
    process.env.ADMIN_ENABLE_PRODUCTION_BONUS_WRITES = 'false'
    process.env.ADMIN_ENABLE_ONBOARDING_DRAFTS = 'false'
    process.env.ADMIN_PUBLIC_ORIGIN = publicOrigin
    process.env.ADMIN_CSRF_SECRET = 'chat02-test-only-mutation-isolation-secret'
    process.env.ADMIN_SECURE_COOKIES = 'false'
    state.db = new PGlite()
    await state.db.exec(`
      CREATE TABLE admin_accounts(id BIGINT PRIMARY KEY,email TEXT,display_name TEXT,role TEXT,password_hash TEXT,active BOOLEAN DEFAULT TRUE,last_login_at TIMESTAMPTZ,updated_at TIMESTAMPTZ);
      CREATE TABLE admin_sessions(token_hash TEXT PRIMARY KEY,admin_id BIGINT,expires_at TIMESTAMPTZ,user_agent TEXT,ip_hash TEXT,last_seen_at TIMESTAMPTZ);
      CREATE TABLE companies(id BIGINT PRIMARY KEY,code TEXT,name TEXT,active BOOLEAN);
      CREATE TABLE venues(id BIGINT PRIMARY KEY,company_id BIGINT,code TEXT,name TEXT,address TEXT,legacy_bar_id BIGINT,active BOOLEAN);
      CREATE TABLE admin_company_access(admin_id BIGINT,company_id BIGINT,access_kind TEXT);
      CREATE TABLE admin_audit_log(admin_id BIGINT,admin_role TEXT,company_id BIGINT,venue_id BIGINT,action TEXT,entity_type TEXT,entity_id TEXT,before_value JSONB,after_value JSONB,reason TEXT,metadata JSONB);
      INSERT INTO companies VALUES(10,'pivnik','North',TRUE),(20,'south','South',TRUE);
      INSERT INTO venues VALUES(101,10,'north','North',NULL,1,TRUE),(202,20,'south','South',NULL,2,TRUE);
      INSERT INTO admin_company_access VALUES(11,10,'owner'),(21,20,'owner');
    `)
    const { hashPassword } = await import('../security.js')
    for (const [id, actor] of [[11, 'north'], [21, 'south']] as const) {
      await state.db.query(
        'INSERT INTO admin_accounts(id,email,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5)',
        [id, actor + '@fixture.invalid', actor, 'VENUE_ADMIN', hashPassword(password)],
      )
    }
    const { handleApi, sendApiError } = await import('../router.js')
    server = http.createServer((req, res) => {
      void handleApi(req, res, new URL(req.url!, origin)).catch(error => sendApiError(res, error, req))
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    origin = 'http://127.0.0.1:' + (server.address() as import('node:net').AddressInfo).port
    for (const actor of ['north', 'south']) {
      const response = await fetch(origin + '/api/admin/auth/login', {
        method: 'POST',
        headers: { origin: publicOrigin, 'content-type': 'application/json' },
        body: JSON.stringify({ email: actor + '@fixture.invalid', password }),
      })
      expect(response.status).toBe(200)
      const payload = await response.json() as { csrfToken: string }
      sessions.set(actor, { cookie: response.headers.get('set-cookie')!.split(';')[0]!, csrf: payload.csrfToken })
    }
  }, 30_000)

  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()))
    await state.db?.close()
  })

  const request = (actor: string, method: string, path: string, body = '{}') => {
    const session = sessions.get(actor)!
    return fetch(origin + path, {
      method,
      headers: {
        cookie: session.cookie,
        origin: publicOrigin,
        'content-type': 'application/json',
        'x-csrf-token': session.csrf,
      },
      ...(method === 'GET' ? {} : { body }),
    })
  }

  it('authenticates two owners, each limited to their own company and venue', async () => {
    for (const [actor, expected] of [['north', '101'], ['south', '202']] as const) {
      const response = await request(actor, 'GET', '/api/admin/venues')
      expect(response.status).toBe(200)
      const payload = await response.json() as { venues: Array<{ id: string; accessKind: string }> }
      expect(payload.venues).toMatchObject([{ id: expected, accessKind: 'owner' }])
    }
  })

  it.each([
    ['POST', 'clients/1/bonus-adjustments'],
    ['POST', 'clients/1/entitlements'],
    ['PUT', 'clients/1/cashback'],
    ['POST', 'clients/1/achievements/grant'],
    ['POST', 'clients/1/app-achievements'],
    ['POST', 'clients/1/frames'],
    ['DELETE', 'clients/1/frames/rare'],
  ])('rejects foreign %s %s before reaching a customer writer', async (method, resource) => {
    for (const [actor, foreignVenue] of [['north', '202'], ['south', '101']] as const) {
      const response = await request(actor, method, '/api/admin/venues/' + foreignVenue + '/' + resource)
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({ code: 'VENUE_NOT_FOUND' })
      expect(state.writerConnects).toBe(0)
    }
  })

  it('does not parse a malformed foreign mutation body before scope denial', async () => {
    for (const [actor, foreignVenue] of [['north', '202'], ['south', '101']] as const) {
      const response = await request(actor, 'POST',
        '/api/admin/venues/' + foreignVenue + '/clients/1/bonus-adjustments', '{')
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({ code: 'VENUE_NOT_FOUND' })
    }
  })

  it.each(['POST', 'PUT', 'DELETE'])('keeps independent tenant CRM customer %s unavailable (read-only)', async method => {
    for (const actor of ['north', 'south']) {
      const response = await request(actor, method,
        '/api/admin/onboarding/drafts/foreign-draft/crm/customers/1')
      expect(response.status).toBe(405)
      expect(await response.json()).toMatchObject({ code: 'METHOD_NOT_ALLOWED' })
    }
  })

  it('keeps the existing owner bonus route disabled without production opt-in', async () => {
    const response = await request('north', 'POST',
      '/api/admin/venues/101/clients/1/bonus-adjustments')
    expect(response.status).toBe(405)
    expect(await response.json()).toMatchObject({ code: 'WRITES_DISABLED' })
    expect(state.writerConnects).toBe(0)
    const audit = await state.db!.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM admin_audit_log WHERE action <> 'auth.login'")
    expect(audit.rows[0]!.count).toBe(0)
  })
})
