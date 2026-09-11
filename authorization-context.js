const PLATFORM_ROLES = new Set(['platform_admin']);
const MEMBERSHIP_ROLES = new Set(['owner', 'staff']);
const LEGACY_ROLES = new Set(['viewer', 'admin', 'staff']);

function normalizeScopeId(value, field) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim();
  if (!normalized) throw new TypeError(`${field} must be a non-empty identifier`);
  return normalized;
}

function normalizeOptionalRole(value, allowed, field) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim();
  if (!allowed.has(normalized)) throw new TypeError(`Unknown ${field}: ${normalized}`);
  return normalized;
}

/**
 * Pure authorization model for the SPACEVERSE SaaS boundary.
 *
 * This module intentionally does not infer tenant/location membership from the
 * historical users.role column. Existing production authorization continues to
 * use its legacy checks until memberships are introduced explicitly.
 */
export function createAuthorizationContext({
  platformRole = null,
  membershipRole = null,
  tenantId = null,
  locationId = null
} = {}) {
  const normalizedPlatformRole = normalizeOptionalRole(platformRole, PLATFORM_ROLES, 'platform role');
  const normalizedMembershipRole = normalizeOptionalRole(membershipRole, MEMBERSHIP_ROLES, 'membership role');
  const normalizedTenantId = normalizeScopeId(tenantId, 'tenantId');
  const normalizedLocationId = normalizeScopeId(locationId, 'locationId');

  if (normalizedLocationId && !normalizedTenantId) {
    throw new TypeError('locationId requires tenantId');
  }

  if (normalizedMembershipRole && !normalizedTenantId) {
    throw new TypeError(`${normalizedMembershipRole} membership requires tenantId`);
  }

  if (normalizedMembershipRole === 'staff' && !normalizedLocationId) {
    throw new TypeError('staff membership requires locationId');
  }

  return Object.freeze({
    platformRole: normalizedPlatformRole,
    membershipRole: normalizedMembershipRole,
    tenantId: normalizedTenantId,
    locationId: normalizedLocationId
  });
}

export function canAccessTenant(context, tenantId) {
  const targetTenantId = normalizeScopeId(tenantId, 'tenantId');
  if (!targetTenantId) return false;
  if (context?.platformRole === 'platform_admin') return true;
  return Boolean(context?.membershipRole && context?.tenantId === targetTenantId);
}

export function canAccessLocation(context, tenantId, locationId) {
  const targetTenantId = normalizeScopeId(tenantId, 'tenantId');
  const targetLocationId = normalizeScopeId(locationId, 'locationId');
  if (!targetTenantId || !targetLocationId) return false;
  if (context?.platformRole === 'platform_admin') return true;
  if (context?.tenantId !== targetTenantId) return false;
  if (context?.membershipRole === 'owner') return true;
  return context?.membershipRole === 'staff' && context?.locationId === targetLocationId;
}

export function canManageTenant(context, tenantId) {
  const targetTenantId = normalizeScopeId(tenantId, 'tenantId');
  if (!targetTenantId) return false;
  if (context?.platformRole === 'platform_admin') return true;
  return context?.membershipRole === 'owner' && context?.tenantId === targetTenantId;
}

export function canWriteLocation(context, tenantId, locationId) {
  return canAccessLocation(context, tenantId, locationId);
}

/**
 * Compatibility description only. It documents current production semantics
 * without pretending legacy global roles are tenant memberships.
 */
export function getLegacyRoleCapabilities(role) {
  const normalizedRole = normalizeOptionalRole(role, LEGACY_ROLES, 'legacy role');
  if (!normalizedRole) {
    return Object.freeze({ staff: false, adminRead: false, adminWrite: false });
  }

  return Object.freeze({
    staff: normalizedRole === 'staff' || normalizedRole === 'admin',
    adminRead: normalizedRole === 'viewer' || normalizedRole === 'admin',
    adminWrite: normalizedRole === 'admin'
  });
}
