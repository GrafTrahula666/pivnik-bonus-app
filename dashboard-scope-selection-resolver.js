import { canAccessLocation, canManageTenant } from './authorization-context.js';
import { DashboardSessionScopeError } from './dashboard-session-scope-resolver.js';

function normalizeIdentifier(value, field) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim();
  if (!normalized) throw new TypeError(`${field} must be a non-empty identifier`);
  return normalized;
}

function normalizeOwnerTenantIds(rows) {
  if (!Array.isArray(rows)) throw new TypeError('loadMemberships must resolve to an array');
  return [...new Set(rows
    .filter((row) => String(row?.role ?? row?.membership_role ?? '').trim() === 'owner')
    .map((row) => normalizeIdentifier(row?.tenantId ?? row?.tenant_id, 'tenantId'))
    .filter(Boolean))];
}

function selectionError(code, statusCode, message) {
  return new DashboardSessionScopeError(code, statusCode, message);
}

function requireDirectory(scopeDirectory) {
  if (!scopeDirectory || typeof scopeDirectory.findTenant !== 'function') {
    throw new TypeError('scopeDirectory.findTenant must be a function');
  }
  if (typeof scopeDirectory.findLocation !== 'function') {
    throw new TypeError('scopeDirectory.findLocation must be a function');
  }
  return scopeDirectory;
}

/**
 * Validate an explicit Dashboard tenant/location selection against the
 * authoritative directory and then re-run the canonical authorization contract.
 *
 * Browser input is only a requested scope. Directory presence proves that the
 * requested active scope exists; it never grants authority. Owners must also
 * prove server-side owner membership before directory lookup. Platform admins
 * may select an active directory scope, but still pass canonical authorization.
 */
export function createDashboardScopeSelectionResolver({
  loadMemberships,
  resolveAuthorization,
  scopeDirectory
} = {}) {
  if (typeof loadMemberships !== 'function') throw new TypeError('loadMemberships must be a function');
  if (typeof resolveAuthorization !== 'function') throw new TypeError('resolveAuthorization must be a function');
  const directory = requireDirectory(scopeDirectory);

  return async function selectDashboardScope({
    userId,
    platformRole = null,
    legacyRole = null,
    tenantId,
    locationId = null
  } = {}) {
    const normalizedUserId = normalizeIdentifier(userId, 'userId');
    const normalizedTenantId = normalizeIdentifier(tenantId, 'tenantId');
    const normalizedLocationId = normalizeIdentifier(locationId, 'locationId');

    if (!normalizedUserId) {
      throw selectionError('authentication_required', 401, 'Authenticated user is required');
    }
    if (!normalizedTenantId) {
      throw selectionError('tenant_selection_required', 400, 'tenantId is required');
    }

    const isPlatformAdmin = platformRole === 'platform_admin';
    if (!isPlatformAdmin) {
      const ownerTenantIds = normalizeOwnerTenantIds(await loadMemberships(normalizedUserId));
      if (!ownerTenantIds.includes(normalizedTenantId)) {
        throw selectionError('dashboard_scope_forbidden', 403, 'Requested tenant is not owned by the user');
      }
    }

    const tenant = await directory.findTenant({ tenantId: normalizedTenantId, activeOnly: true });
    if (!tenant) {
      throw selectionError('dashboard_scope_forbidden', 403, 'Requested tenant is unavailable');
    }

    if (normalizedLocationId) {
      const location = await directory.findLocation({
        tenantId: normalizedTenantId,
        locationId: normalizedLocationId,
        activeOnly: true
      });
      if (!location) {
        throw selectionError('dashboard_scope_forbidden', 403, 'Requested location is unavailable');
      }
    }

    const authorization = await resolveAuthorization({
      userId: normalizedUserId,
      platformRole,
      legacyRole,
      tenantId: normalizedTenantId,
      locationId: normalizedLocationId
    });

    const authorized = normalizedLocationId
      ? canAccessLocation(authorization?.context, normalizedTenantId, normalizedLocationId)
      : canManageTenant(authorization?.context, normalizedTenantId);
    if (!authorized) {
      throw selectionError('dashboard_scope_forbidden', 403, 'Requested scope is not authorized');
    }

    return Object.freeze({
      tenantId: normalizedTenantId,
      locationId: normalizedLocationId
    });
  };
}

export const dashboardScopeSelectionResolverContract = Object.freeze({
  browserSelectionGrantsAuthority: false,
  authoritativeDirectoryRequired: true,
  ownerMembershipRequired: true,
  authorizationRecheckedAfterSelection: true,
  crossTenantSelectionDenied: true,
  crossTenantLocationSelectionDenied: true,
  platformAdminSelectionEnabled: true,
  locationSelectionEnabled: true,
  inactiveDirectoryScopeDenied: true,
  externalDependenciesAdded: false
});
