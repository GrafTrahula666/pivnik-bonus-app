import { canManageTenant } from './authorization-context.js';

const MEMBERSHIP_ROLES = new Set(['owner', 'staff']);

function normalizeIdentifier(value, field) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim();
  if (!normalized) throw new TypeError(`${field} must be a non-empty identifier`);
  return normalized;
}

function normalizeMembership(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new TypeError('membership row must be an object');
  }

  const role = String(row.role ?? row.membership_role ?? '').trim();
  if (!MEMBERSHIP_ROLES.has(role)) {
    throw new TypeError(`Unknown membership role: ${role || '<empty>'}`);
  }

  const tenantId = normalizeIdentifier(row.tenantId ?? row.tenant_id, 'tenantId');
  const locationId = normalizeIdentifier(row.locationId ?? row.location_id, 'locationId');
  if (!tenantId) throw new TypeError(`${role} membership requires tenantId`);
  if (role === 'owner' && locationId) {
    throw new TypeError('owner membership must be tenant-scoped');
  }
  if (role === 'staff' && !locationId) {
    throw new TypeError('staff membership requires locationId');
  }

  return Object.freeze({ role, tenantId, locationId });
}

export class DashboardSessionScopeError extends Error {
  constructor(code, statusCode, message) {
    super(message);
    this.name = 'DashboardSessionScopeError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function scopeError(code, statusCode, message) {
  return new DashboardSessionScopeError(code, statusCode, message);
}

/**
 * Resolve the Dashboard scope from server-side membership state only.
 *
 * The browser supplies no tenant/location identifier. A tenant is selected
 * automatically only when one owner tenant is unambiguous. Multi-tenant owners
 * and platform administrators deliberately fail closed until a separately
 * audited server-side scope-selection mechanism exists.
 */
export function createDashboardSessionScopeResolver({
  loadMemberships,
  resolveAuthorization
} = {}) {
  if (typeof loadMemberships !== 'function') {
    throw new TypeError('loadMemberships must be a function');
  }
  if (typeof resolveAuthorization !== 'function') {
    throw new TypeError('resolveAuthorization must be a function');
  }

  return async function resolveDashboardSessionScope({
    userId,
    platformRole = null,
    legacyRole = null
  } = {}) {
    const normalizedUserId = normalizeIdentifier(userId, 'userId');
    if (!normalizedUserId) {
      throw scopeError('authentication_required', 401, 'Authenticated user is required');
    }

    if (platformRole === 'platform_admin') {
      throw scopeError(
        'scope_selection_required',
        409,
        'Platform administrator scope cannot be selected implicitly'
      );
    }

    const loaded = await loadMemberships(normalizedUserId);
    if (!Array.isArray(loaded)) {
      throw new TypeError('loadMemberships must resolve to an array');
    }

    const memberships = loaded.map(normalizeMembership);
    const ownerTenantIds = [...new Set(
      memberships
        .filter((membership) => membership.role === 'owner')
        .map((membership) => membership.tenantId)
    )];

    if (ownerTenantIds.length === 0) {
      if (memberships.some((membership) => membership.role === 'staff')) {
        throw scopeError(
          'dashboard_manager_required',
          403,
          'Tenant manager access is required for the owner Dashboard'
        );
      }
      throw scopeError('dashboard_scope_unavailable', 403, 'No Dashboard tenant scope is available');
    }

    if (ownerTenantIds.length !== 1) {
      throw scopeError(
        'scope_selection_required',
        409,
        'Multiple owner tenant scopes require explicit server-side selection'
      );
    }

    const tenantId = ownerTenantIds[0];
    const authorization = await resolveAuthorization({
      userId: normalizedUserId,
      platformRole,
      legacyRole,
      tenantId,
      locationId: null
    });

    if (!canManageTenant(authorization?.context, tenantId)) {
      throw scopeError('dashboard_scope_forbidden', 403, 'Resolved tenant scope is not authorized');
    }

    return Object.freeze({ tenantId, locationId: null });
  };
}

export const dashboardSessionScopeResolverContract = Object.freeze({
  browserSuppliedTenantAccepted: false,
  browserSuppliedLocationAccepted: false,
  singleOwnerTenantMayResolveImplicitly: true,
  multipleOwnerTenantsRequireSelection: true,
  platformAdminRequiresSelection: true,
  staffTenantWideDashboardAccess: false,
  authorizationRecheckedAfterDiscovery: true,
  readOnly: true,
  externalDependenciesAdded: false
});
