import { canAccessLocation, canManageTenant } from './authorization-context.js';
import { DashboardSessionScopeError } from './dashboard-session-scope-resolver.js';

function normalizeIdentifier(value, field) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim();
  if (!normalized) throw new TypeError(`${field} must be a non-empty identifier`);
  return normalized;
}

function scopeError(code, statusCode, message) {
  return new DashboardSessionScopeError(code, statusCode, message);
}

function requireDirectory(scopeDirectory) {
  if (!scopeDirectory || typeof scopeDirectory.listTenants !== 'function') {
    throw new TypeError('scopeDirectory.listTenants must be a function');
  }
  if (typeof scopeDirectory.listLocations !== 'function' || typeof scopeDirectory.findTenant !== 'function') {
    throw new TypeError('scopeDirectory listLocations/findTenant must be functions');
  }
  return scopeDirectory;
}

function ownerTenantIds(rows) {
  if (!Array.isArray(rows)) throw new TypeError('loadMemberships must resolve to an array');
  return [...new Set(rows
    .filter((row) => String(row?.role ?? row?.membership_role ?? '').trim() === 'owner')
    .map((row) => normalizeIdentifier(row?.tenantId ?? row?.tenant_id, 'tenantId'))
    .filter(Boolean))];
}

export function createDashboardScopeDirectoryResolver({
  loadMemberships,
  resolveAuthorization,
  scopeDirectory
} = {}) {
  if (typeof loadMemberships !== 'function') throw new TypeError('loadMemberships must be a function');
  if (typeof resolveAuthorization !== 'function') throw new TypeError('resolveAuthorization must be a function');
  const directory = requireDirectory(scopeDirectory);

  async function authorizeTenant({ userId, platformRole, legacyRole, tenantId }) {
    const authorization = await resolveAuthorization({
      userId,
      platformRole,
      legacyRole,
      tenantId,
      locationId: null
    });
    if (!canManageTenant(authorization?.context, tenantId)) {
      throw scopeError('dashboard_scope_forbidden', 403, 'Requested tenant is not authorized');
    }
    return authorization.context;
  }

  return async function resolveDashboardScopeDirectory({
    userId,
    platformRole = null,
    legacyRole = null,
    tenantId = null
  } = {}) {
    const normalizedUserId = normalizeIdentifier(userId, 'userId');
    const normalizedTenantId = normalizeIdentifier(tenantId, 'tenantId');
    if (!normalizedUserId) throw scopeError('authentication_required', 401, 'Authenticated user is required');

    const isPlatformAdmin = platformRole === 'platform_admin';
    let allowedOwnerTenants = null;
    if (!isPlatformAdmin) {
      allowedOwnerTenants = ownerTenantIds(await loadMemberships(normalizedUserId));
      if (allowedOwnerTenants.length === 0) {
        throw scopeError('dashboard_manager_required', 403, 'Tenant manager access is required');
      }
    }

    if (!normalizedTenantId) {
      const candidates = isPlatformAdmin
        ? await directory.listTenants({ activeOnly: true, limit: 200, offset: 0 })
        : (await Promise.all(allowedOwnerTenants.map((id) => directory.findTenant({ tenantId: id, activeOnly: true })))).filter(Boolean);

      const tenants = [];
      for (const tenant of candidates) {
        try {
          await authorizeTenant({
            userId: normalizedUserId,
            platformRole,
            legacyRole,
            tenantId: tenant.tenantId
          });
          tenants.push(Object.freeze({ tenantId: tenant.tenantId, displayName: tenant.displayName }));
        } catch (error) {
          if (!(error instanceof DashboardSessionScopeError)) throw error;
        }
      }
      return Object.freeze({ tenants: Object.freeze(tenants) });
    }

    if (!isPlatformAdmin && !allowedOwnerTenants.includes(normalizedTenantId)) {
      throw scopeError('dashboard_scope_forbidden', 403, 'Requested tenant is not owned by the user');
    }

    const tenant = await directory.findTenant({ tenantId: normalizedTenantId, activeOnly: true });
    if (!tenant) throw scopeError('dashboard_scope_forbidden', 403, 'Requested tenant is unavailable');

    const context = await authorizeTenant({
      userId: normalizedUserId,
      platformRole,
      legacyRole,
      tenantId: normalizedTenantId
    });

    const rows = await directory.listLocations({
      tenantId: normalizedTenantId,
      activeOnly: true,
      limit: 200,
      offset: 0
    });
    const locations = rows
      .filter((location) => canAccessLocation(context, normalizedTenantId, location.locationId))
      .map((location) => Object.freeze({ locationId: location.locationId, displayName: location.displayName }));

    return Object.freeze({
      tenant: Object.freeze({ tenantId: tenant.tenantId, displayName: tenant.displayName }),
      locations: Object.freeze(locations)
    });
  };
}

export const dashboardScopeDirectoryResolverContract = Object.freeze({
  readOnly: true,
  activeDirectoryOnly: true,
  ownerDirectoryReadsRestrictedToMemberships: true,
  platformAdminDirectoryListingEnabled: true,
  canonicalAuthorizationRechecked: true,
  locationReadsRequireAuthorizedTenant: true,
  browserInputCanOnlyNarrowScope: true,
  externalDependenciesAdded: false
});
