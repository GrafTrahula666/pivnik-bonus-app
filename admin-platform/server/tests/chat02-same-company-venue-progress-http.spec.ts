// @vitest-environment node
import http from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { config } from '../config.js'
import { fixturePassword } from './onboarding-fixture.js'
import { tenantCrmFixture } from './tenant-crm-fixture.js'
import type { TenantCrmFixtureDatabase } from './tenant-crm-database-fixture.js'

// CHAT 02 #15: a trusted company grant must not widen the separate, revocable
// onboarding invitation when reading or saving a sibling venue's progress.
// Uses disposable PGlite by default; native PostgreSQL requires an explicit
// guarded SPACEVERSE_TEST_NATIVE_POSTGRES_URL, never a production database.
const state = vi.hoisted(() => ({ metadata: null as TenantCrmFixtureDatabase | null }))
vi.mock('../db.js', () => {
  const query = async (sql: string, params?: unknown[]) => {
    const result = await state.metadata!.query(sql, params)
    return { ...result, rowCount: result.affectedRows ?? result.rows.length }
  }
  const pool = {
    query,
    connect: async () => {
      const client = state.metadata!.connect
        ? await state.metadata!.connect()
        : { query: state.metadata!.query.bind(state.metadata!), release() {} }
      return {
        query: async (sql: string, params?: unknown[]) => {
          const result = await client.query(sql, params)
          return { ...result, rowCount: result.affectedRows ?? result.rows.length }
        },
        release: () => client.release(),
      }
    },
  }
  return { pool, readPool: pool, writePool: null,
    tableExists: async () => false, productionTableExists: async () => false }
})

describe('CHAT 02 #15: signed HTTP onboarding progress is venue-scoped', () => {
  let server: http.Server
  let origin = ''
  let fixture: Awaited<ReturnType<typeof tenantCrmFixture>>
  const sessions = new Map<string, { cookie: string; csrf: string }>()
  const oldFlags = {
    enableWrites: config.enableWrites,
    enableOnboardingDrafts: config.enableOnboardingDrafts,
    enableOnboardingInvitations: config.enableOnboardingInvitations,
    enableOnboardingWorkflow: config.enableOnboardingWorkflow,
    publicOrigin: config.publicOrigin,
    csrfSecret: config.csrfSecret,
  }
  const path = (index: number) =>
    `/api/admin/onboarding/drafts/${fixture.manifests[index]!.source.draftId}/progress`
  const command = {
    revision: 0,
    progress: {
      currentStep: 'terminal',
      terminal: { id: 'synthetic-terminal-15', label: 'Fixture only' },
      cashReports: false,
    },
  }
  const request = (who: 'owner' | 'trusted', method: 'GET' | 'PUT', url: string) => {
    const session = sessions.get(who)!
    return fetch(origin + url, {
      method,
      headers: {
        cookie: session.cookie,
        ...(method === 'PUT' ? {
          origin: config.publicOrigin,
          'content-type': 'application/json',
          'x-csrf-token': session.csrf,
        } : {}),
      },
      ...(method === 'PUT' ? { body: JSON.stringify(command) } : {}),
    })
  }

  beforeAll(async () => {
    config.enableWrites = config.enableOnboardingDrafts =
      config.enableOnboardingInvitations = config.enableOnboardingWorkflow = true
    config.publicOrigin = 'https://chat02-progress.fixture.invalid'
    config.csrfSecret = 'synthetic-chat02-progress-only-secret-123456789'
    fixture = await tenantCrmFixture()
    state.metadata = fixture.metadata
    const { handleApi, sendApiError } = await import('../router.js')
    server = http.createServer((req, res) => {
      void handleApi(req, res, new URL(req.url!, origin))
        .catch(error => sendApiError(res, error, req))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
    for (const who of ['owner', 'trusted'] as const) {
      const response = await fetch(origin + '/api/admin/auth/login', {
        method: 'POST',
        headers: { origin: config.publicOrigin, 'content-type': 'application/json' },
        body: JSON.stringify({ email: who + '@fixture.invalid', password: fixturePassword }),
      })
      expect(response.status).toBe(200)
      sessions.set(who, {
        cookie: response.headers.get('set-cookie')!.split(';')[0]!,
        csrf: (await response.json() as { csrfToken: string }).csrfToken,
      })
    }
  }, 90_000)

  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()))
    for (const db of fixture?.targets ?? []) await db.close()
    await state.metadata?.close()
    Object.assign(config, oldFlags)
  })

  it('denies sibling progress read/write and applies revocation on the same session', async () => {
    const ownDraft = fixture.manifests[0]!.source.draftId
    const siblingDraft = fixture.manifests[1]!.source.draftId
    expect(fixture.manifests[0]!.scope.companyId).toBe(fixture.manifests[1]!.scope.companyId)
    expect(fixture.manifests[0]!.scope.venueId).not.toBe(fixture.manifests[1]!.scope.venueId)
    expect((await state.metadata!.query<{ access_kind: string }>(
      'SELECT access_kind FROM admin_company_access WHERE admin_id=12 AND company_id=10',
    )).rows).toEqual([{ access_kind: 'trusted' }])

    expect((await request('trusted', 'GET', path(0))).status).toBe(200)
    expect((await request('trusted', 'GET', path(1))).status).toBe(404)
    expect((await request('trusted', 'PUT', path(1))).status).toBe(404)
    expect((await state.metadata!.query(
      'SELECT draft_id FROM admin_onboarding_progress WHERE draft_id=$1::uuid', [siblingDraft],
    )).rows).toEqual([])

    const saved = await request('trusted', 'PUT', path(0))
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({ revision: 1, progress: command.progress })
    expect((await state.metadata!.query(
      'SELECT draft_id FROM admin_onboarding_progress WHERE draft_id=$1::uuid', [ownDraft],
    )).rows).toHaveLength(1)
    expect((await request('owner', 'GET', path(0))).status).toBe(200)
    expect((await request('owner', 'GET', path(1))).status).toBe(200)

    await state.metadata!.query(
      'UPDATE admin_onboarding_access SET revoked_at=NOW() WHERE invitation_id=$1',
      [fixture.viewerInvite],
    )
    expect((await request('trusted', 'GET', path(0))).status).toBe(403)
    expect((await request('trusted', 'PUT', path(0))).status).toBe(403)
    expect((await request('owner', 'GET', path(0))).status).toBe(200)
    expect((await state.metadata!.query(
      'SELECT draft_id FROM admin_onboarding_progress WHERE draft_id=$1::uuid', [siblingDraft],
    )).rows).toEqual([])
  })
})
