// @vitest-environment node
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { config } from '../config.js'
import { fixturePassword } from './onboarding-fixture.js'
import { tenantCrmApplication, tenantCrmFixture } from './tenant-crm-fixture.js'
import type { TenantCrmFixtureDatabase } from './tenant-crm-database-fixture.js'

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

// CHAT 02 #15: the same-company company grant must not widen a venue invitation.
// The fixture uses PGlite by default, or isolated loopback PostgreSQL when
// SPACEVERSE_TEST_NATIVE_POSTGRES_URL is explicitly provided.
describe('CHAT 02 #15: signed HTTP venue isolation within one company', () => {
  let server: http.Server
  let origin = ''
  let fixture: Awaited<ReturnType<typeof tenantCrmFixture>>
  const sessions = new Map<string, { cookie: string; csrf: string }>()
  const oldFlags = {
    enableWrites: config.enableWrites,
    enableOnboardingDrafts: config.enableOnboardingDrafts,
    enableOnboardingInvitations: config.enableOnboardingInvitations,
    enableOnboardingSupport: config.enableOnboardingSupport,
    enableOnboardingWorkflow: config.enableOnboardingWorkflow,
    publicOrigin: config.publicOrigin,
    csrfSecret: config.csrfSecret,
  }
  const draft = (index: number) =>
    `/api/admin/onboarding/drafts/${fixture.manifests[index]!.source.draftId}`
  const support = (index: number) => draft(index) + '/support'
  const request = (who: string | null, method: 'GET' | 'POST' | 'PUT', path: string,
    body?: unknown, csrf = true, requestOrigin = config.publicOrigin) => {
    const session = who ? sessions.get(who) : undefined
    return fetch(origin + path, {
      method,
      headers: {
        ...(session ? { cookie: session.cookie } : {}),
        ...(method !== 'GET' ? {
          origin: requestOrigin, 'content-type': 'application/json',
          ...(csrf ? { 'x-csrf-token': session?.csrf ?? '' } : {}),
        } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }

  beforeAll(async () => {
    config.enableWrites = config.enableOnboardingDrafts =
      config.enableOnboardingInvitations = config.enableOnboardingSupport =
      config.enableOnboardingWorkflow = true
    config.publicOrigin = 'https://chat02-venue-http.fixture.invalid'
    config.csrfSecret = 'synthetic-chat02-venue-http-secret-123456789'
    fixture = await tenantCrmFixture()
    state.metadata = fixture.metadata
    const { handleApi, sendApiError } = await import('../router.js')
    server = http.createServer((req, res) => {
      void handleApi(req, res, new URL(req.url!, origin))
        .catch(error => sendApiError(res, error, req))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
    for (const who of ['owner', 'trusted']) {
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

  afterEach(async () => {
    await state.metadata!.query(
      "UPDATE admin_onboarding_access SET role='manager',revoked_at=NULL WHERE invitation_id=$1",
      [fixture.viewerInvite],
    )
    const { __resetRateLimitBucketsForTests } = await import('../security.js')
    __resetRateLimitBucketsForTests()
  })

  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()))
    for (const db of fixture?.targets ?? []) await db.close()
    await state.metadata?.close()
    Object.assign(config, oldFlags)
  })

  it('keeps a trusted company director limited to the specifically invited venue', async () => {
    const trustedGrant = await state.metadata!.query<{ access_kind: string }>(
      'SELECT access_kind FROM admin_company_access WHERE admin_id=12 AND company_id=10',
    )
    expect(trustedGrant.rows).toEqual([{ access_kind: 'trusted' }])
    expect(fixture.manifests[0]!.scope.companyId).toBe(fixture.manifests[1]!.scope.companyId)
    expect(fixture.manifests[0]!.scope.venueId).not.toBe(fixture.manifests[1]!.scope.venueId)

    expect((await request('trusted', 'GET', draft(0))).status).toBe(200)
    expect((await request('trusted', 'GET', draft(1))).status).toBe(404)
    expect((await request('trusted', 'POST', support(0), { topic: 'connection' })).status).toBe(200)
    expect((await request('trusted', 'POST', support(1), { topic: 'connection' })).status).toBe(404)
    const foreign = await state.metadata!.query(
      'SELECT id FROM admin_onboarding_support_requests WHERE draft_id=$1',
      [fixture.manifests[1]!.source.draftId],
    )
    expect(foreign.rows).toEqual([])

    // The explicit company owner remains company-wide, by existing policy.
    expect((await request('owner', 'GET', draft(0))).status).toBe(200)
    expect((await request('owner', 'GET', draft(1))).status).toBe(200)
  })

  it('denies sibling prepared application and scope reads on a signed trusted session', async () => {
    for (const resource of ['application', 'scope'] as const) {
      const own = await request('trusted', 'GET', `${draft(0)}/${resource}`)
      expect(own.status).toBe(200)
      expect((await own.json() as Record<string, unknown>)[resource]).toBeTruthy()

      const ownerSibling = await request('owner', 'GET', `${draft(1)}/${resource}`)
      expect(ownerSibling.status).toBe(200)
      expect((await ownerSibling.json() as Record<string, unknown>)[resource]).toBeTruthy()

      const denied = await request('trusted', 'GET', `${draft(1)}/${resource}`)
      expect(denied.status).toBe(404)
      expect(await denied.json()).toMatchObject({ code: 'ONBOARDING_DRAFT_NOT_FOUND' })
    }
  })

  it('denies sibling prepared application and scope writes without changing persisted state', async () => {
    const sibling = fixture.manifests[1]!
    const draftId = sibling.source.draftId
    const snapshot = async () => {
      const [application, scope, audit] = await Promise.all([
        state.metadata!.query(
          'SELECT revision,config::text FROM admin_onboarding_app_configs WHERE draft_id=$1::uuid',
          [draftId],
        ),
        state.metadata!.query(
          'SELECT company_id::text,venue_id::text,draft_revision,application_revision FROM admin_onboarding_scopes WHERE draft_id=$1::uuid',
          [draftId],
        ),
        state.metadata!.query('SELECT count(*)::int AS count FROM admin_audit_log'),
      ])
      return { application: application.rows, scope: scope.rows, audit: audit.rows }
    }
    const before = await snapshot()
    const commands = [
      { resource: 'application', body: { revision: 1, config: tenantCrmApplication } },
      { resource: 'scope', body: { draftRevision: 1, applicationRevision: 1 } },
    ] as const

    for (const { resource, body } of commands) {
      const denied = await request('trusted', 'PUT', `${draft(1)}/${resource}`, body)
      expect(denied.status).toBe(404)
      expect(await denied.json()).toMatchObject({ code: 'ONBOARDING_DRAFT_NOT_FOUND' })
    }
    expect(await snapshot()).toEqual(before)
    expect((await request('owner', 'GET', `${draft(1)}/application`)).status).toBe(200)
    expect((await request('owner', 'GET', `${draft(1)}/scope`)).status).toBe(200)
  })

  it('denies sibling draft PUT with a current revision without changing SQL or audit', async () => {
    const siblingDraftId = fixture.manifests[1]!.source.draftId
    const draftRows = () => state.metadata!.query<{ revision: number; data: string }>(
      'SELECT revision,data::text AS data FROM admin_onboarding_drafts WHERE id=$1::uuid',
      [siblingDraftId],
    )
    const auditRows = () => state.metadata!.query(
      'SELECT count(*)::int AS count FROM admin_audit_log',
    )
    const before = await draftRows()
    expect(before.rows).toHaveLength(1)
    const auditBefore = await auditRows()

    // Positive authorization control: the manager has an explicit write grant
    // for their own venue; sibling 404 must not be mistaken for a global ban.
    const ownDraft = await request('trusted', 'GET', draft(0))
    expect(ownDraft.status).toBe(200)
    expect(await ownDraft.json()).toMatchObject({
      permissions: { canWrite: true, role: 'manager' },
    })

    // A valid current-revision command must reach the draft authorization gate,
    // not be rejected merely for malformed input or a stale revision.
    const denied = await request('trusted', 'PUT', draft(1), {
      revision: before.rows[0]!.revision,
      data: JSON.parse(before.rows[0]!.data),
    })
    expect(denied.status).toBe(404)
    expect(await denied.json()).toMatchObject({ code: 'ONBOARDING_DRAFT_NOT_FOUND' })
    expect((await draftRows()).rows).toEqual(before.rows)
    expect((await auditRows()).rows).toEqual(auditBefore.rows)
    expect((await request('owner', 'GET', draft(1))).status).toBe(200)
  })

  it('rechecks viewer downgrade and revocation on the same signed session', async () => {
    expect((await request('trusted', 'GET', draft(0))).status).toBe(200)
    await state.metadata!.query(
      "UPDATE admin_onboarding_access SET role='viewer' WHERE invitation_id=$1",
      [fixture.viewerInvite],
    )
    const downgraded = await request('trusted', 'GET', draft(0))
    expect(downgraded.status).toBe(200)
    expect(await downgraded.json()).toMatchObject({
      permissions: { canWrite: false, role: 'viewer' },
    })
    // A viewer must not retain a stale manager write privilege on the same
    // signed session, even with the current revision and valid draft data.
    const ownDraftId = fixture.manifests[0]!.source.draftId
    const draftRows = () => state.metadata!.query<{ revision: number; data: string }>(
      'SELECT revision,data::text AS data FROM admin_onboarding_drafts WHERE id=$1::uuid',
      [ownDraftId],
    )
    const auditRows = () => state.metadata!.query(
      'SELECT count(*)::int AS count FROM admin_audit_log',
    )
    const before = await draftRows()
    expect(before.rows).toHaveLength(1)
    const auditBefore = await auditRows()
    const deniedWrite = await request('trusted', 'PUT', draft(0), {
      revision: before.rows[0]!.revision,
      data: JSON.parse(before.rows[0]!.data),
    })
    expect(deniedWrite.status).toBe(403)
    expect(await deniedWrite.json()).toMatchObject({ code: 'ONBOARDING_ACCESS_REQUIRED' })
    expect((await draftRows()).rows).toEqual(before.rows)
    expect((await auditRows()).rows).toEqual(auditBefore.rows)

    expect((await request('trusted', 'POST', support(0), { topic: 'access' })).status).toBe(403)
    expect((await request('trusted', 'GET', draft(1))).status).toBe(404)

    const listPaths = ['/api/admin/onboarding/drafts', '/api/admin/onboarding/venues']
    for (const path of listPaths) {
      const response = await request('trusted', 'GET', path)
      expect(response.status).toBe(200)
      const data = await response.json() as {
        drafts?: { id: string }[]
        venues?: { kind: string; id: string }[]
      }
      const draftIds = path.endsWith('/drafts')
        ? (data.drafts ?? []).map(item => item.id)
        : (data.venues ?? []).filter(item => item.kind === 'draft').map(item => item.id)
      expect(draftIds).toContain(fixture.manifests[0]!.source.draftId)
      expect(draftIds).not.toContain(fixture.manifests[1]!.source.draftId)
    }
    await state.metadata!.query(
      'UPDATE admin_onboarding_access SET revoked_at=NOW() WHERE invitation_id=$1',
      [fixture.viewerInvite],
    )
    expect((await request('trusted', 'GET', draft(0))).status).toBe(403)
    // Revocation must also invalidate the old signed session for mutations,
    // even when the client supplies the last valid draft revision and payload.
    const revokedWrite = await request('trusted', 'PUT', draft(0), {
      revision: before.rows[0]!.revision,
      data: JSON.parse(before.rows[0]!.data),
    })
    expect(revokedWrite.status).toBe(403)
    expect(await revokedWrite.json()).toMatchObject({ code: 'ONBOARDING_ACCESS_REQUIRED' })
    expect((await draftRows()).rows).toEqual(before.rows)
    expect((await auditRows()).rows).toEqual(auditBefore.rows)
    expect((await request('trusted', 'POST', support(0), { topic: 'access' })).status).toBe(403)
    for (const path of listPaths) {
      expect((await request('trusted', 'GET', path)).status).toBe(403)
    }
  })

  it('does not leak a sibling prepared venue through onboarding list endpoints', async () => {
    const own = fixture.manifests[0]!.source.draftId
    const sibling = fixture.manifests[1]!.source.draftId
    const foreignCompany = fixture.manifests[2]!.source.draftId

    for (const path of ['/api/admin/onboarding/drafts', '/api/admin/onboarding/venues']) {
      const visibleDraftIds = async (who: 'owner' | 'trusted') => {
        const response = await request(who, 'GET', path)
        expect(response.status).toBe(200)
        const data = await response.json() as {
          drafts?: { id: string }[]
          venues?: { kind: string; id: string }[]
        }
        return path.endsWith('/drafts')
          ? (data.drafts ?? []).map(item => item.id)
          : (data.venues ?? []).filter(item => item.kind === 'draft').map(item => item.id)
      }

      const trusted = await visibleDraftIds('trusted')
      expect(trusted).toContain(own)
      expect(trusted).not.toContain(sibling)
      expect(trusted).not.toContain(foreignCompany)

      const owner = await visibleDraftIds('owner')
      expect(owner).toContain(own)
      expect(owner).toContain(sibling)
      expect(owner).not.toContain(foreignCompany)
    }
  })

  it('does not widen invitation target selectors for a trusted company director', async () => {
    const path = '/api/admin/onboarding/invitations'
    const trusted = await request('trusted', 'GET', path)
    expect(trusted.status).toBe(200)
    const restricted = await trusted.json() as {
      invitations: unknown[]; companies: { id: string }[]; venues: { id: string }[]
    }
    expect(restricted.invitations).toEqual([])
    expect(restricted.companies).toEqual([])
    expect(restricted.venues).toEqual([])

    // Company ownership, unlike a trusted grant, permits choosing both venues.
    const owner = await request('owner', 'GET', path)
    expect(owner.status).toBe(200)
    const permitted = await owner.json() as {
      companies: { id: string }[]; venues: { id: string }[]
    }
    expect(permitted.companies.map(item => item.id)).toContain('10')
    const venueIds = permitted.venues.map(item => item.id)
    expect(venueIds).toContain(fixture.manifests[0]!.scope.venueId)
    expect(venueIds).toContain(fixture.manifests[1]!.scope.venueId)
    expect(venueIds).not.toContain(fixture.manifests[2]!.scope.venueId)
  })

  it('rejects same-company invitation issuance by a venue-only trusted director', async () => {
    const before = await state.metadata!.query(
      'SELECT id::text,created_by_admin_id::text,company_id::text,venue_id::text FROM admin_onboarding_invites ORDER BY id',
    )
    const auditBefore = await state.metadata!.query(
      "SELECT count(*)::int AS count FROM admin_audit_log WHERE action='onboarding.invitation_create'",
    )

    // A trusted company grant must not authorize invitation issuance for either
    // the invited venue or its sibling; both are owner-only mutations.
    for (const venueId of [
      fixture.manifests[0]!.scope.venueId,
      fixture.manifests[1]!.scope.venueId,
    ]) {
      const response = await request('trusted', 'POST', '/api/admin/onboarding/invitations', {
        requestKey: randomUUID(), companyId: '10', venueId,
        role: 'viewer', expiresInHours: 24,
      })
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ code: 'INVITATION_OWNER_REQUIRED' })
    }
    const after = await state.metadata!.query(
      'SELECT id::text,created_by_admin_id::text,company_id::text,venue_id::text FROM admin_onboarding_invites ORDER BY id',
    )
    const auditAfter = await state.metadata!.query(
      "SELECT count(*)::int AS count FROM admin_audit_log WHERE action='onboarding.invitation_create'",
    )
    expect(after.rows).toEqual(before.rows)
    expect(auditAfter.rows).toEqual(auditBefore.rows)
  })

  it('rejects URL and body company/venue substitution without creating support rows', async () => {
    const siblingVenue = fixture.manifests[1]!.scope.venueId
    const ownVenue = fixture.manifests[0]!.scope.venueId
    const before = await state.metadata!.query(
      'SELECT draft_id::text,topic FROM admin_onboarding_support_requests ORDER BY draft_id,topic',
    )

    for (const [method, path, body] of [
      ['GET', support(0) + '?venueId=' + siblingVenue, undefined],
      ['POST', support(0) + '?companyId=20', { topic: 'access' }],
      ['POST', support(0), { topic: 'access', companyId: '10', venueId: siblingVenue }],
      ['POST', support(0), { topic: 'access', tenantId: '20' }],
      ['POST', support(1), { topic: 'access', companyId: '10', venueId: ownVenue }],
    ] as const) {
      const response = await request('trusted', method, path, body)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ code: 'ONBOARDING_SUPPORT_INVALID' })
    }

    const after = await state.metadata!.query(
      'SELECT draft_id::text,topic FROM admin_onboarding_support_requests ORDER BY draft_id,topic',
    )
    expect(after.rows).toEqual(before.rows)
  })

  it('rejects unsigned and CSRF/origin-bypassing support writes', async () => {
    expect((await request(null, 'GET', draft(0))).status).toBe(401)
    expect((await request('trusted', 'POST', support(0), { topic: 'connection' }, false)).status).toBe(403)
    expect((await request('trusted', 'POST', support(0), { topic: 'connection' }, true,
      'https://foreign.fixture.invalid')).status).toBe(403)
  })
  it('does not expose a persisted sibling support ticket through signed reads or the platform queue', async () => {
    const sibling = fixture.manifests[1]!.source.draftId
    const own = fixture.manifests[0]!.source.draftId

    // A real stored ticket distinguishes authorization denial from an empty sibling.
    const created = await request('owner', 'POST', support(1), { topic: 'activation' })
    expect(created.status).toBe(200)
    expect(await created.json()).toMatchObject({
      draftId: sibling,
      requests: [expect.objectContaining({ draftId: sibling, topic: 'activation' })],
    })
    expect((await request('owner', 'GET', support(1))).status).toBe(200)

    expect((await request('trusted', 'GET', support(1))).status).toBe(404)
    // An existing sibling ticket must not make a foreign mutation possible.
    expect((await request('trusted', 'POST', support(1), { topic: 'connection' })).status).toBe(404)
    const allowed = await request('trusted', 'GET', support(0))
    expect(allowed.status).toBe(200)
    const body = await allowed.json() as { draftId: string; requests: { draftId: string }[] }
    expect(body.draftId).toBe(own)
    expect(body.requests.some(item => item.draftId === sibling)).toBe(false)
    expect((await request('trusted', 'GET', '/api/admin/onboarding/support')).status).toBe(403)

    const persisted = await state.metadata!.query<{ draft_id: string; topic: string }>(
      'SELECT draft_id::text,topic FROM admin_onboarding_support_requests WHERE draft_id=$1::uuid',
      [sibling],
    )
    expect(persisted.rows).toEqual([{ draft_id: sibling, topic: 'activation' }])
  })

  it('preserves company-owner invitation issuance with exact sibling venue binding', async () => {
    const sibling = fixture.manifests[1]!
    const response = await request('owner', 'POST', '/api/admin/onboarding/invitations', {
      requestKey: randomUUID(), companyId: sibling.scope.companyId,
      venueId: sibling.scope.venueId, role: 'viewer', expiresInHours: 24,
    })
    expect(response.status).toBe(200)
    const issued = await response.json() as {
      invitation: { id: string; companyId: string; venueId: string; draftId: string; role: string }
    }
    const expected = {
      companyId: sibling.scope.companyId, venueId: sibling.scope.venueId,
      draftId: sibling.source.draftId, role: 'viewer',
    }
    expect(issued.invitation).toMatchObject(expected)
    const persisted = await state.metadata!.query<{
      companyId: string; venueId: string; draftId: string; role: string
    }>(`SELECT company_id::text AS "companyId", venue_id::text AS "venueId",
      draft_id::text AS "draftId", role FROM admin_onboarding_invites WHERE id=$1::uuid`,
    [issued.invitation.id])
    expect(persisted.rows).toEqual([expected])
    // Issuance alone must not widen the trusted director's venue A grant.
    expect((await request('trusted', 'GET', draft(1))).status).toBe(404)

    // A real owner-issued sibling invitation must remain invisible to a
    // trusted director, including its recoverable link and revoke endpoint.
    const path = '/api/admin/onboarding/invitations'
    const ownerList = await request('owner', 'GET', path)
    expect(ownerList.status).toBe(200)
    const owned = await ownerList.json() as { invitations: { id: string }[] }
    expect(owned.invitations.some(item => item.id === issued.invitation.id)).toBe(true)
    const trustedList = await request('trusted', 'GET', path)
    expect(trustedList.status).toBe(200)
    expect((await trustedList.json() as { invitations: unknown[] }).invitations).toEqual([])

    const invitationState = () => state.metadata!.query(
      'SELECT id::text,status,revoked_at::text FROM admin_onboarding_invites WHERE id=$1::uuid',
      [issued.invitation.id],
    )
    const audit = () => state.metadata!.query('SELECT count(*)::int AS count FROM admin_audit_log')
    const beforeState = await invitationState()
    const auditBefore = await audit()
    for (const action of ['link', 'revoke']) {
      const denied = await request('trusted', 'POST', `${path}/${issued.invitation.id}/${action}`)
      expect(denied.status).toBe(404)
      expect(await denied.json()).toMatchObject({ code: 'INVITATION_NOT_FOUND' })
    }
    expect((await invitationState()).rows).toEqual(beforeState.rows)
    expect((await audit()).rows).toEqual(auditBefore.rows)
  })

  it('does not reuse an owner invitation request key for a sibling venue', async () => {
    const venueA = fixture.manifests[0]!
    const venueB = fixture.manifests[1]!
    const requestKey = randomUUID()
    const path = '/api/admin/onboarding/invitations'
    const command = {
      requestKey, companyId: venueA.scope.companyId, venueId: venueA.scope.venueId,
      role: 'viewer', expiresInHours: 24,
    }
    const created = await request('owner', 'POST', path, command)
    expect(created.status).toBe(200)
    const original = await created.json() as { invitation: { id: string; venueId: string } }
    expect(original.invitation.venueId).toBe(venueA.scope.venueId)

    const rows = () => state.metadata!.query(
      'SELECT id::text,company_id::text,venue_id::text,request_key::text FROM admin_onboarding_invites WHERE request_key=$1::uuid ORDER BY id',
      [requestKey],
    )
    const auditCount = () => state.metadata!.query(
      "SELECT count(*)::int AS count FROM admin_audit_log WHERE action='onboarding.invitation_create'",
    )
    const before = await rows()
    expect(before.rows).toHaveLength(1)
    const auditBefore = await auditCount()

    // Reusing the same UUID for venue B must not return venue A's token or create B's grant.
    const conflict = await request('owner', 'POST', path, {
      ...command, venueId: venueB.scope.venueId,
    })
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({ code: 'INVITATION_REQUEST_CONFLICT' })
    expect((await rows()).rows).toEqual(before.rows)
    expect((await auditCount()).rows).toEqual(auditBefore.rows)

    const replay = await request('owner', 'POST', path, command)
    expect(replay.status).toBe(200)
    expect((await replay.json() as { invitation: { id: string } }).invitation.id)
      .toBe(original.invitation.id)
    expect((await rows()).rows).toEqual(before.rows)
    expect((await auditCount()).rows).toEqual(auditBefore.rows)
  })

})
