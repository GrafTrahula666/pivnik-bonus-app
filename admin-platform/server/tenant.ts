import type { QueryResultRow } from 'pg'
import { pool } from './db.js'
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
}

export function parsePositiveId(raw: string, fieldName = 'id'): string {
  const value = String(raw || '').trim()
  if (!/^[1-9]\d*$/.test(value)) {
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
      AND EXISTS (
        SELECT 1
        FROM admin_company_access aca
        WHERE aca.company_id = v.company_id
          AND aca.admin_id = $2::bigint
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
  const params: string[] = []
  let accessClause = ''
  if (admin.role !== 'SUPER_ADMIN') {
    params.push(admin.id)
    accessClause = `
      JOIN admin_company_access aca
        ON aca.company_id = v.company_id
       AND aca.admin_id = $1::bigint`
  }
  const result = await pool.query<VenueScopeRow>(
    `SELECT
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
     ${accessClause}
     WHERE v.active = TRUE AND c.active = TRUE
     ORDER BY c.name, v.name`,
    params,
  )
  return result.rows.map((row) => ({
    id: row.id,
    companyId: row.company_id,
    companyCode: row.company_code,
    companyName: row.company_name,
    code: row.code,
    name: row.name,
    address: row.address,
    legacyBarId: row.legacy_bar_id,
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
