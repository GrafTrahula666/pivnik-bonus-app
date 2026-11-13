import type { Pool, QueryResultRow } from 'pg'
import { config } from './config.js'
import { HttpError, type AdminPrincipal, type VenueScope } from './types.js'

type EntitlementDb = Pick<Pool, 'query'>
type AiEntitlementStatus = 'not_configured' | 'forbidden' | 'unavailable' | 'disabled' | 'expired' | 'active'

export interface AiEntitlementView {
  enabled: boolean
  status: AiEntitlementStatus
  code: string
}

interface AiRow extends QueryResultRow {
  state: string
  enabled: boolean
  approved_at: Date | string | null
  expires_at: Date | string | null
  approval_reference: string | null
}

const denied = (status: Exclude<AiEntitlementStatus, 'active'>, code: string): AiEntitlementView =>
  ({ enabled: false, status, code })

// Only an ACTIVE, non-expired, explicitly approved entitlement can pass.
// The platform flag is independently OFF by default. This is not a provider
// connection or a billing activation API.
export async function getAiEntitlementStatus(
  db: EntitlementDb,
  admin: AdminPrincipal,
  scope: VenueScope,
  now: Date = new Date(),
): Promise<AiEntitlementView> {
  if (!config.enableAi) return denied('not_configured', 'AI_PLATFORM_DISABLED')
  if (!Number.isFinite(now.getTime())) return denied('unavailable', 'AI_CLOCK_INVALID')

  try {
    // Check live canonical company/venue and the live Admin role/access record.
    // A trusted director with GET pos permission does NOT inherit AI access.
    // A user-supplied companyId or venueId is never authorization by itself.
    const access = await db.query<{ allowed: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM venues v
         JOIN companies c ON c.id = v.company_id
         JOIN admin_accounts a ON a.id = $3::bigint
         WHERE v.id = $1::bigint
           AND v.company_id = $2::bigint
           AND v.active = TRUE AND c.active = TRUE AND a.active = TRUE
           AND a.role = $4
           AND (
             a.role = 'SUPER_ADMIN'
             OR EXISTS (
               SELECT 1 FROM admin_company_access aca
               WHERE aca.admin_id = a.id AND aca.company_id = v.company_id
                 AND aca.access_kind = 'owner'
             )
           )
       ) AS allowed`,
      [scope.id, scope.companyId, admin.id, admin.role],
    )
    if (access.rows[0]?.allowed !== true) return denied('forbidden', 'AI_ACCESS_FORBIDDEN')

    const schema = await db.query<{ present: boolean }>(
      `SELECT to_regclass('public.admin_ai_entitlements') IS NOT NULL AS present`,
    )
    if (schema.rows[0]?.present !== true) return denied('not_configured', 'AI_ENTITLEMENT_SCHEMA_MISSING')

    const result = await db.query<AiRow>(
      `SELECT state, enabled, approved_at, expires_at, approval_reference
       FROM admin_ai_entitlements WHERE venue_id = $1::bigint LIMIT 1`,
      [scope.id],
    )
    const row = result.rows[0]
    if (!row) return denied('not_configured', 'AI_ENTITLEMENT_NOT_CONFIGURED')
    if (row.state !== 'active' || row.enabled !== true) return denied('disabled', 'AI_ENTITLEMENT_DISABLED')

    const approved = row.approved_at == null ? NaN : new Date(row.approved_at).getTime()
    const expiry = row.expires_at == null ? NaN : new Date(row.expires_at).getTime()
    if (!Number.isFinite(approved) || !Number.isFinite(expiry) ||
      approved > now.getTime() || expiry <= approved ||
      !row.approval_reference || row.approval_reference.trim().length < 5) {
      return denied('unavailable', 'AI_ENTITLEMENT_EVIDENCE_INVALID')
    }
    if (expiry <= now.getTime()) return denied('expired', 'AI_ENTITLEMENT_EXPIRED')
    return { enabled: true, status: 'active', code: 'AI_ENTITLEMENT_ACTIVE' }
  } catch {
    // Database failure must never be treated as granted access.
    return denied('unavailable', 'AI_ENTITLEMENT_CHECK_FAILED')
  }
}

export async function requireAiEntitlement(
  db: EntitlementDb,
  admin: AdminPrincipal,
  scope: VenueScope,
  now: Date = new Date(),
): Promise<void> {
  const access = await getAiEntitlementStatus(db, admin, scope, now)
  if (!access.enabled) throw new HttpError(403, 'AI_ENTITLEMENT_REQUIRED', 'AI для этого заведения не подключён.')
}
