import type { QueryResultRow } from 'pg'
import { pool } from './db.js'
import { config } from './config.js'
import { HttpError, type AdminPrincipal, type VenueScope } from './types.js'

interface VenueScopeRow extends QueryResultRow {
  id: string
  company_id: string
  company_code: string
  company_name: string
  code: string
  name: string
  address: string | null
  legacy_bar_id: string | null
  access_kind?: string
}

// Exact accepted invitation scope for active, non-legacy tenant venues.
function invitedRole(venueAlias:string,actorParam:string):string{
  return `SELECT grant.role FROM admin_onboarding_access grant
    JOIN admin_onboarding_invites invitation ON invitation.id=grant.invitation_id
    WHERE grant.admin_id=${actorParam}::bigint
      AND grant.company_id=${venueAlias}.company_id
      AND (grant.venue_id IS NULL OR grant.venue_id=${venueAlias}.id)
      AND ${venueAlias}.legacy_bar_id IS NULL
      AND grant.revoked_at IS NULL
      AND grant.role IN ('owner','manager','viewer')
      AND invitation.revoked_at IS NULL
      AND invitation.status='claimed' AND invitation.claimed_at IS NOT NULL
      AND invitation.claimed_admin_id=grant.admin_id
      AND invitation.company_id=grant.company_id
      AND invitation.venue_id IS NOT DISTINCT FROM grant.venue_id
      AND invitation.role=grant.role
    ORDER BY CASE grant.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END
    LIMIT 1`
}
function viewerCanRead(resource:string,child:string,grandchild:string):boolean{
  if(resource==='clients')return !grandchild||grandchild==='rewards'
  return !child&&!grandchild&&['dashboard','pos','operations','capabilities'].includes(resource)
}
// The existing admin_company_access owner/trusted distinction is also the
// authorization boundary for a trusted marketing director. Fail closed.
export function trustedDirectorCanWrite(method: string, resource: string, child: string, grandchild: string): boolean {
  if (method === 'POST' && resource === 'broadcast' && !child) return true
  if (resource === 'app' && child === 'promotions') {
    return (method === 'POST' && !grandchild) || (method === 'PUT' && Boolean(grandchild))
  }
  if (method === 'PUT' && resource === 'promotions' && child === 'manage' && !grandchild) return true
  return false
}

export function trustedDirectorCanRead(resource: string, child: string, grandchild: string): boolean {
  if (resource === 'clients') return !grandchild || grandchild === 'rewards'
  if (resource === 'broadcast') return !child || (child === 'preview' && !grandchild)
  if (resource === 'app') return child === 'promotions' && !grandchild
  if (resource === 'promotions' && child === 'manage' && !grandchild) return true
  return !child && !grandchild && ['dashboard', 'pos', 'operations', 'achievements', 'wheel', 'shop', 'promotions', 'capabilities', 'audit'].includes(resource)
}

export async function requireVenueAccess(
  admin: AdminPrincipal, scope: VenueScope, method: string,
  resource: string, child: string, grandchild: string,
): Promise<void> {
  if (admin.role === 'SUPER_ADMIN') return
  const result = await pool.query<{access_kind:string}>(
    'SELECT access_kind FROM admin_company_access WHERE admin_id=$1::bigint AND company_id=$2::bigint',
    [admin.id, scope.companyId],
  )
  const accessKind = result.rows[0]?.access_kind
  if(accessKind==='owner')return
  let role:string|undefined
  if(config.enableOnboardingInvitations&&!scope.legacyBarId){
    const invited=await pool.query<{role:string}>(`SELECT permitted.role FROM venues v
      JOIN companies c ON c.id=v.company_id AND c.active=TRUE
      CROSS JOIN LATERAL (${invitedRole('v','$1')}) permitted
      WHERE v.id=$2::bigint AND v.company_id=$3::bigint AND v.active=TRUE`,
      [admin.id,scope.id,scope.companyId])
    role=invited.rows[0]?.role
  }
  if(role==='owner')return
  if((accessKind==='trusted'||role==='manager')&&(method==='GET'
    ? trustedDirectorCanRead(resource,child,grandchild)
    : trustedDirectorCanWrite(method,resource,child,grandchild)))return
  if(role==='viewer'&&method==='GET'&&viewerCanRead(resource,child,grandchild))return
  if (method === 'GET') throw new HttpError(403, 'DIRECTOR_READ_FORBIDDEN', 'У этой учётной записи нет доступа к данному разделу.')
  throw new HttpError(403, 'DIRECTOR_WRITE_FORBIDDEN', 'У этой учётной записи нет прав на изменение данного раздела.')
}

export function parsePositiveId(raw: string, fieldName = 'id'): string {
  const value = String(raw || '').trim()
  if (!/^[1-9]\d*$/.test(value) || BigInt(value) > 9223372036854775807n) {
    throw new HttpError(400, 'INVALID_ID', `Некорректный ${fieldName}.`)
  }
  return value
}

export function buildVenueScopeQuery(
  admin: AdminPrincipal,
  rawVenueId: string,
): { text: string; params: string[] } {
  const venueId = parsePositiveId(rawVenueId, 'venue_id')
  const params: string[] = [venueId]
  let accessClause = ''
  if (admin.role !== 'SUPER_ADMIN') {
    params.push(admin.id)
    accessClause = `
      AND (
        EXISTS(SELECT 1 FROM admin_company_access aca
          WHERE aca.company_id=v.company_id AND aca.admin_id=$2::bigint
            AND aca.access_kind IN ('owner','trusted'))
        ${config.enableOnboardingInvitations?`OR EXISTS(${invitedRole('v','$2')})`:''}
      )`
  }
  return {
    text: `SELECT
       v.id::text,
       v.company_id::text,
       c.code AS company_code,
       c.name AS company_name,
       v.code,
       v.name,
       v.address,
       v.legacy_bar_id::text
     FROM venues v
     JOIN companies c ON c.id = v.company_id
     WHERE v.id = $1::bigint
       AND v.active = TRUE
       AND c.active = TRUE
       ${accessClause}
     LIMIT 1`,
    params,
  }
}

export async function resolveVenueScope(
  admin: AdminPrincipal,
  rawVenueId: string,
): Promise<VenueScope> {
  const statement = buildVenueScopeQuery(admin, rawVenueId)
  const result = await pool.query<VenueScopeRow>(
    statement.text,
    statement.params,
  )

  const row = result.rows[0]
  if (!row) {
    throw new HttpError(404, 'VENUE_NOT_FOUND', 'Заведение не найдено или недоступно.')
  }
  return {
    id: row.id,
    companyId: row.company_id,
    companyCode: row.company_code,
    companyName: row.company_name,
    code: row.code,
    name: row.name,
    address: row.address,
    legacyBarId: row.legacy_bar_id,
  }
}

export async function listAuthorizedVenues(admin: AdminPrincipal): Promise<VenueScope[]> {
  const params:string[]=admin.role==='SUPER_ADMIN'?[]:[admin.id]
  const withInvite=admin.role!=='SUPER_ADMIN'&&config.enableOnboardingInvitations
  const companyJoin=admin.role==='SUPER_ADMIN'?'':`LEFT JOIN admin_company_access aca
    ON aca.company_id=v.company_id AND aca.admin_id=$1::bigint`
  const inviteJoin=withInvite?`LEFT JOIN LATERAL (${invitedRole('v','$1')}) invited ON TRUE`:''
  const effective=admin.role==='SUPER_ADMIN'?"'owner'":withInvite
    ?`CASE WHEN aca.access_kind='owner' OR invited.role='owner' THEN 'owner'
      WHEN aca.access_kind='trusted' THEN 'trusted' ELSE invited.role END`:'aca.access_kind'
  const allowed=admin.role==='SUPER_ADMIN'?'':`
    AND (aca.access_kind IN ('owner','trusted') ${withInvite?'OR invited.role IS NOT NULL':''})`
  const result=await pool.query<VenueScopeRow>(
    `SELECT v.id::text,v.company_id::text,c.code AS company_code,
      c.name AS company_name,v.code,v.name,v.address,v.legacy_bar_id::text,
      ${effective} AS access_kind
      FROM venues v JOIN companies c ON c.id=v.company_id
      ${companyJoin} ${inviteJoin}
      WHERE v.active=TRUE AND c.active=TRUE ${allowed}
      ORDER BY c.name,v.name`,params)
  return result.rows.map((row) => ({
    id: row.id,
    companyId: row.company_id,
    companyCode: row.company_code,
    companyName: row.company_name,
    code: row.code,
    name: row.name,
    address: row.address,
    legacyBarId: row.legacy_bar_id,
    accessKind: (['owner','trusted','manager','viewer'].includes(String(row.access_kind))?row.access_kind:'viewer') as VenueScope['accessKind'],
  }))
}

export function requireSuperAdmin(admin: AdminPrincipal): void {
  if (admin.role !== 'SUPER_ADMIN') {
    throw new HttpError(403, 'SUPER_ADMIN_REQUIRED', 'Доступно только SUPER ADMIN.')
  }
}

export function assertScopedUserVenue(
  expectedLegacyBarId: string | null,
  actualBarId: string | null,
): void {
  if (!expectedLegacyBarId || !actualBarId || expectedLegacyBarId !== actualBarId) {
    throw new HttpError(404, 'CUSTOMER_NOT_FOUND', 'Клиент не найден в этом заведении.')
  }
}
