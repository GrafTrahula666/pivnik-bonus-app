// @vitest-environment node
import http from 'node:http'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ db: null as PGlite | null }))
vi.mock('../db.js', () => {
  const query = async (sql: string, params?: unknown[]) => {
    const result = await state.db!.query(sql, params)
    return { ...result, rowCount: result.rows.length || result.affectedRows || 0 }
  }
  const adapter = { query, connect: async () => ({ query, release() {} }) }
  return {
    pool: adapter, readPool: adapter, writePool: adapter,
    productionTableExists: async () => false, tableExists: async () => false,
  }
})

describe('audit authorization through the HTTP router and disposable PostgreSQL', () => {
  let server: http.Server | undefined
  let origin = ''
  const cookies = new Map<string, string>()

  beforeAll(async () => {
    vi.stubEnv('ADMIN_PUBLIC_ORIGIN', 'https://audit.fixture.invalid')
    vi.stubEnv('ADMIN_CSRF_SECRET', 'fixture-only-audit-secret-1234567890')
    state.db = new PGlite()
    await state.db.exec(`
      CREATE TABLE admin_accounts (
        id BIGINT PRIMARY KEY, email TEXT, display_name TEXT, role TEXT,
        password_hash TEXT, active BOOLEAN DEFAULT TRUE,
        last_login_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
      );
      CREATE TABLE admin_sessions (
        token_hash TEXT PRIMARY KEY, admin_id BIGINT, expires_at TIMESTAMPTZ,
        user_agent TEXT, ip_hash TEXT, last_seen_at TIMESTAMPTZ
      );
      CREATE TABLE companies (id BIGINT PRIMARY KEY, code TEXT, name TEXT, active BOOLEAN);
      CREATE TABLE venues (
        id BIGINT PRIMARY KEY, company_id BIGINT, code TEXT, name TEXT,
        address TEXT, legacy_bar_id BIGINT, active BOOLEAN
      );
      CREATE TABLE admin_company_access (admin_id BIGINT, company_id BIGINT, access_kind TEXT);
      CREATE TABLE admin_audit_log (
        id BIGSERIAL PRIMARY KEY, admin_id BIGINT, company_id BIGINT, venue_id BIGINT,
        action TEXT, entity_type TEXT, entity_id TEXT, before_value JSONB, after_value JSONB,
        reason TEXT, admin_role TEXT, metadata JSONB, created_at TIMESTAMPTZ DEFAULT NOW()
      );
      INSERT INTO companies VALUES (10,'alpha','Alpha',TRUE),(20,'beta','Beta',TRUE);
      INSERT INTO venues VALUES
        (101,10,'alpha-one','Alpha one',NULL,NULL,TRUE),
        (102,10,'alpha-two','Alpha two',NULL,NULL,TRUE),
        (201,20,'beta-one','Beta one',NULL,NULL,TRUE);
      INSERT INTO admin_company_access VALUES (11,10,'owner'),(12,10,'trusted'),(21,20,'owner');
      INSERT INTO admin_audit_log (company_id,venue_id,action) VALUES
        (10,101,'audit.alpha-one'),(10,102,'audit.alpha-two'),(20,201,'audit.beta-one'),
        (10,NULL,'audit.alpha-company'),(20,NULL,'audit.beta-company'),(NULL,NULL,'audit.platform');
    `)
    const password = 'Fixture-Audit-Only-2026!'
    const { hashPassword } = await import('../security.js')
    for (const [id, who, role] of [
      [1, 'root', 'SUPER_ADMIN'], [11, 'alpha', 'VENUE_ADMIN'],
      [12, 'trusted', 'VENUE_ADMIN'], [21, 'beta', 'VENUE_ADMIN'],
    ] as const) {
      await state.db.query(
        'INSERT INTO admin_accounts (id,email,display_name,role,password_hash) VALUES ($1,$2,$3,$4,$5)',
        [id, `${who}@fixture.invalid`, who, role, hashPassword(password)],
      )
    }
    const { handleApi, sendApiError } = await import('../router.js')
    server = http.createServer((req, res) => {
      void handleApi(req, res, new URL(req.url!, origin)).catch(error => sendApiError(res, error, req))
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
    for (const who of ['root', 'alpha', 'trusted', 'beta']) {
      const response = await fetch(`${origin}/api/admin/auth/login`, {
        method: 'POST',
        headers: { origin: 'https://audit.fixture.invalid', 'content-type': 'application/json' },
        body: JSON.stringify({ email: `${who}@fixture.invalid`, password }),
      })
      expect(response.status).toBe(200)
      await response.json()
      cookies.set(who, response.headers.get('set-cookie')!.split(';')[0]!)
    }
  }, 30_000)

  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()))
    await state.db?.close()
    vi.unstubAllEnvs()
  })

  function request(who: string | null, path: string) {
    return fetch(origin + path, { headers: who ? { cookie: cookies.get(who)! } : {} })
  }

  async function actions(who: string, path: string) {
    const response = await request(who, path)
    expect(response.status).toBe(200)
    const body = await response.json() as { rows: Array<{ action: string }> }
    return body.rows.map(row => row.action)
  }

  it('requires a session for venue and platform audit', async () => {
    for (const path of ['/api/admin/venues/101/audit', '/api/admin/audit']) {
      expect((await request(null, path)).status).toBe(401)
    }
  })

  it('keeps two venues in the same company separate for owners and trusted staff', async () => {
    for (const who of ['alpha', 'trusted']) {
      expect(await actions(who, '/api/admin/venues/101/audit')).toEqual(['audit.alpha-one'])
      expect(await actions(who, '/api/admin/venues/102/audit')).toEqual(['audit.alpha-two'])
    }
    expect(await actions('beta', '/api/admin/venues/201/audit')).toEqual(['audit.beta-one'])
  })

  it('cannot replace the path scope with company or venue query parameters', async () => {
    expect(await actions('alpha', '/api/admin/venues/101/audit?company_id=20&venue_id=201&companyId=20&venueId=102'))
      .toEqual(['audit.alpha-one'])
  })

  it('denies cross-company venue access even with a claimed authorized scope', async () => {
    for (const who of ['alpha', 'trusted']) {
      const response = await request(who, '/api/admin/venues/201/audit?company_id=10&venue_id=101')
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({ code: 'VENUE_NOT_FOUND' })
    }
    expect((await request('beta', '/api/admin/venues/101/audit')).status).toBe(404)
  })

  it('restricts the global audit to SUPER_ADMIN', async () => {
    for (const who of ['alpha', 'trusted', 'beta']) {
      const response = await request(who, '/api/admin/audit?venue_id=101')
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ code: 'SUPER_ADMIN_REQUIRED' })
    }
    expect(new Set(await actions('root', '/api/admin/audit'))).toEqual(new Set([
      'audit.alpha-one', 'audit.alpha-two', 'audit.beta-one',
      'audit.alpha-company', 'audit.beta-company', 'audit.platform',
      'auth.login',
    ]))
  })

  it('also limits SUPER_ADMIN venue reads to the selected venue', async () => {
    expect(await actions('root', '/api/admin/venues/101/audit')).toEqual(['audit.alpha-one'])
  })

  it('checks current access again when a logged-in owner loses their company grant', async () => {
    await state.db!.query('DELETE FROM admin_company_access WHERE admin_id=21')
    const response = await request('beta', '/api/admin/venues/201/audit')
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'VENUE_NOT_FOUND' })
  })
})
