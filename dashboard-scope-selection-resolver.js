import { canManageTenant } from './authorization-context.js';
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

/**
 * Validate an explicit Dashboard tenant selection against server-side owner
 * memberships, then re-run the canonical authorization contract.
 *
 * A browser may request a tenant identifier, but it never grants authority:
 * only an existing owner membership can make that selection valid. Location
 * selection and platform-admin selection remain fail-closed until an
 * authoritative tenant/location directory exists.
 */
export function createDashboardScopeSelectionResolver({
  loadMemberships,
  resolveAuthorization
} = {}) {
  if (typeof loadMemberships !== 'function') throw new TypeError('loadMemberships must be a function');
  if (typeof resolveAuthorization !== 'function') throw new TypeError('resolveAuthorization must be a function');

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
    if (normalizedLocationId) {
      throw selectionError(
        'location_selection_unavailable',
        409,
        'Location selection requires an authoritative tenant/location directory'
      );
    }
    if (platformRole === 'platform_admin') {
      throw selectionError(
        'platform_scope_directory_required',
        409,
        'Platform administrator selection requires an authoritative tenant directory'
      );
    }

    const ownerTenantIds = normalizeOwnerTenantIds(await loadMemberships(normalizedUserId));
    if (!ownerTenantIds.includes(normalizedTenantId)) {
      throw selectionError('dashboard_scope_forbidden', 403, 'Requested tenant is not owned by the user');
    }

    const authorization = await resolveAuthorization({
      userId: normalizedUserId,
      platformRole,
      legacyRole,
      tenantId: normalizedTenantId,
      locationId: null
    });

    if (!canManageTenant(authorization?.context, normalizedTenantId)) {
      throw selectionError('dashboard_scope_forbidden', 403, 'Requested tenant is not authorized');
    }

    return Object.freeze({ tenantId: normalizedTenantId, locationId: null });
  };
}

export const dashboardScopeSelectionResolverContract = Object.freeze({
  browserSelectionGrantsAuthority: false,
  ownerMembershipRequired: true,
  authorizationRecheckedAfterSelection: true,
  crossTenantSelectionDenied: true,
  platformAdminSelectionEnabled: false,
  locationSelectionEnabled: false,
  externalDependenciesAdded: false
});
