function requireQuery(query) {
  if (typeof query !== 'function') throw new TypeError('query must be a function');
}

function normalizeRequired(value, field) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new TypeError(`${field} is required`);
  }
  return String(value).trim();
}

function normalizeLimit(value) {
  const limit = value === undefined ? 100 : Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new TypeError('limit must be an integer between 1 and 200');
  }
  return limit;
}

function normalizeOffset(value) {
  const offset = value === undefined ? 0 : Number(value);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new TypeError('offset must be a non-negative integer');
  }
  return offset;
}

function mapTenant(row) {
  return Object.freeze({
    tenantId: String(row.tenant_id),
    displayName: String(row.display_name),
    status: String(row.status)
  });
}

function mapLocation(row) {
  return Object.freeze({
    locationId: String(row.location_id),
    tenantId: String(row.tenant_id),
    displayName: String(row.display_name),
    status: String(row.status)
  });
}

/**
 * Read-only access to the authoritative SPACEVERSE tenant/location directory.
 *
 * This repository never derives scope from transactions, customer activity or
 * legacy roles. Authorization remains the caller's responsibility; directory
 * membership alone never grants access.
 */
export function createScopeDirectoryRepository({ query } = {}) {
  requireQuery(query);

  return Object.freeze({
    async listTenants({ activeOnly = true, limit = 100, offset = 0 } = {}) {
      if (typeof activeOnly !== 'boolean') throw new TypeError('activeOnly must be a boolean');
      const normalizedLimit = normalizeLimit(limit);
      const normalizedOffset = normalizeOffset(offset);
      const result = await query(
        `SELECT tenant_id, display_name, status
         FROM spaceverse_tenants
         WHERE ($1::boolean = false OR status = 'active')
         ORDER BY display_name ASC, tenant_id ASC
         LIMIT $2 OFFSET $3`,
        [activeOnly, normalizedLimit, normalizedOffset]
      );
      return (result.rows || []).map(mapTenant);
    },

    async listLocations({ tenantId, activeOnly = true, limit = 100, offset = 0 } = {}) {
      const normalizedTenantId = normalizeRequired(tenantId, 'tenantId');
      if (typeof activeOnly !== 'boolean') throw new TypeError('activeOnly must be a boolean');
      const normalizedLimit = normalizeLimit(limit);
      const normalizedOffset = normalizeOffset(offset);
      const result = await query(
        `SELECT location_id, tenant_id, display_name, status
         FROM spaceverse_locations
         WHERE tenant_id = $1
           AND ($2::boolean = false OR status = 'active')
         ORDER BY display_name ASC, location_id ASC
         LIMIT $3 OFFSET $4`,
        [normalizedTenantId, activeOnly, normalizedLimit, normalizedOffset]
      );
      return (result.rows || []).map(mapLocation);
    },

    async findTenant({ tenantId, activeOnly = true } = {}) {
      const normalizedTenantId = normalizeRequired(tenantId, 'tenantId');
      if (typeof activeOnly !== 'boolean') throw new TypeError('activeOnly must be a boolean');
      const result = await query(
        `SELECT tenant_id, display_name, status
         FROM spaceverse_tenants
         WHERE tenant_id = $1
           AND ($2::boolean = false OR status = 'active')
         LIMIT 1`,
        [normalizedTenantId, activeOnly]
      );
      return result.rows?.[0] ? mapTenant(result.rows[0]) : null;
    },

    async findLocation({ tenantId, locationId, activeOnly = true } = {}) {
      const normalizedTenantId = normalizeRequired(tenantId, 'tenantId');
      const normalizedLocationId = normalizeRequired(locationId, 'locationId');
      if (typeof activeOnly !== 'boolean') throw new TypeError('activeOnly must be a boolean');
      const result = await query(
        `SELECT location_id, tenant_id, display_name, status
         FROM spaceverse_locations
         WHERE tenant_id = $1
           AND location_id = $2
           AND ($3::boolean = false OR status = 'active')
         LIMIT 1`,
        [normalizedTenantId, normalizedLocationId, activeOnly]
      );
      return result.rows?.[0] ? mapLocation(result.rows[0]) : null;
    }
  });
}

export const scopeDirectoryRepositoryContract = Object.freeze({
  migration: '011_spaceverse_scope_directory.sql',
  readOnly: true,
  authoritativeSource: true,
  infersFromTransactions: false,
  authorizationGrantedByDirectory: false,
  requiresTenantForLocationReads: true,
  globalLocationFallback: false,
  externalDependenciesAdded: false
});
