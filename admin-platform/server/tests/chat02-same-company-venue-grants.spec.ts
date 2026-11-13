// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { config } from '../config.js'
import { onboardingDraftAccessSql } from '../onboarding-access.js'

// CHAT 02 #15: disposable SQL evidence for two venues under ONE company.
// This tests the current onboarding grant predicate, not legacy company-wide
// venue administration or a production/native-PostgreSQL HTTP route.
describe('CHAT 02 #15: same-company onboarding venue grants', () => {
  const first = '11111111-1111-4111-8111-111111111111'
  const second = '22222222-2222-4222-8222-222222222222'
  let db: PGlite
  let invitationsBefore = false

  beforeAll(async () => {
    invitationsBefore = config.enableOnboardingInvitations
    config.enableOnboardingInvitations = true
    db = new PGlite()
    await db.exec(`
      CREATE TABLE admin_accounts(id BIGINT PRIMARY KEY,role TEXT,active BOOLEAN);
      CREATE TABLE admin_company_access(admin_id BIGINT,company_id BIGINT,access_kind TEXT);
      CREATE TABLE admin_onboarding_drafts(id UUID PRIMARY KEY,admin_id BIGINT,company_id BIGINT);
      CREATE TABLE admin_onboarding_scopes(draft_id UUID PRIMARY KEY,company_id BIGINT,venue_id BIGINT);
      CREATE TABLE admin_onboarding_access(
        invitation_id UUID PRIMARY KEY,admin_id BIGINT,company_id BIGINT,
        venue_id BIGINT,draft_id UUID,role TEXT,revoked_at TIMESTAMPTZ
      );
      INSERT INTO admin_accounts VALUES
        (1,'SUPER_ADMIN',TRUE),(11,'VENUE_ADMIN',TRUE),
        (12,'VENUE_ADMIN',TRUE),(13,'VENUE_ADMIN',TRUE),(14,'VENUE_ADMIN',TRUE);
      INSERT INTO admin_company_access VALUES (11,10,'owner');
      INSERT INTO admin_onboarding_drafts VALUES
        ('11111111-1111-4111-8111-111111111111',1,10),
        ('22222222-2222-4222-8222-222222222222',1,10);
      INSERT INTO admin_onboarding_scopes VALUES
        ('11111111-1111-4111-8111-111111111111',10,101),
        ('22222222-2222-4222-8222-222222222222',10,102);
      INSERT INTO admin_onboarding_access VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',12,10,101,'11111111-1111-4111-8111-111111111111','manager',NULL),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',13,10,102,'22222222-2222-4222-8222-222222222222','manager',NULL),
        ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',14,10,101,'11111111-1111-4111-8111-111111111111','viewer',NULL);
    `)
  })

  afterEach(async () => {
    await db.exec(`
      UPDATE admin_onboarding_access SET role='manager',revoked_at=NULL WHERE admin_id IN (12,13);
      UPDATE admin_onboarding_access SET role='viewer',revoked_at=NULL WHERE admin_id=14;
      DELETE FROM admin_company_access WHERE admin_id=12;
    `)
  })

  afterAll(async () => {
    config.enableOnboardingInvitations = invitationsBefore
    await db?.close()
  })

  async function allowed(actor: number, draftId: string, write = false): Promise<boolean> {
    const predicate = onboardingDraftAccessSql('draft', '$2', write)
    const result = await db.query<{ id: string }>(
      `SELECT draft.id::text AS id FROM admin_onboarding_drafts draft
       WHERE draft.id=$1::uuid AND ${predicate}`,
      [draftId, actor],
    )
    return result.rows.length === 1
  }

  it('limits each venue manager to their own draft for both reads and writes', async () => {
    for (const write of [false, true]) {
      expect(await allowed(12, first, write)).toBe(true)
      expect(await allowed(12, second, write)).toBe(false)
      expect(await allowed(13, second, write)).toBe(true)
      expect(await allowed(13, first, write)).toBe(false)
    }
  })

  it('does not treat a same-company trusted director grant as venue ownership', async () => {
    await db.query('INSERT INTO admin_company_access VALUES($1,$2,$3)', [12, 10, 'trusted'])
    expect(await allowed(12, first, true)).toBe(true)
    expect(await allowed(12, second, false)).toBe(false)
    expect(await allowed(12, second, true)).toBe(false)
  })

  it('keeps a venue viewer read-only and scoped to their selected venue', async () => {
    expect(await allowed(14, first)).toBe(true)
    expect(await allowed(14, first, true)).toBe(false)
    expect(await allowed(14, second)).toBe(false)
    expect(await allowed(14, second, true)).toBe(false)
  })

  it('preserves explicitly company-wide owner access to both venues', async () => {
    for (const draftId of [first, second]) {
      expect(await allowed(11, draftId)).toBe(true)
      expect(await allowed(11, draftId, true)).toBe(true)
    }
  })

  it('rechecks revocation and role downgrade instead of retaining prior access', async () => {
    expect(await allowed(12, first, true)).toBe(true)
    await db.query('UPDATE admin_onboarding_access SET revoked_at=NOW() WHERE admin_id=$1', [12])
    expect(await allowed(12, first)).toBe(false)
    expect(await allowed(12, first, true)).toBe(false)
    expect(await allowed(13, second, true)).toBe(true)
    await db.query("UPDATE admin_onboarding_access SET role='viewer' WHERE admin_id=$1", [13])
    expect(await allowed(13, second)).toBe(true)
    expect(await allowed(13, second, true)).toBe(false)
  })
})
