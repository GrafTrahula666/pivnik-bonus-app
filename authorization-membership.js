import {
  createAuthorizationContext,
  getLegacyRoleCapabilities
} from './authorization-context.js';

const MEMBERSHIP_ROLES = new Set(['owner', 'staff']);

function normalizeId(value, field) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim();
  if (!normalized) throw new TypeError(`${field} must be a non-empty identifier`);
  return normalized;
}

function normalizeMembership(row) {
  if (!row || typeof row !== 'object') {
    throw new TypeError('membership row must be an object');
  }

  const role = String(row.role || row.membership_role || '').trim();
  if (!MEMBERSHIP_ROLES.has(role)) {
    throw new TypeError(`Unknown membership role: ${role || '<empty>'}`);
  }

  const tenantId = normalizeId(row.tenantId ?? row.tenant_id, 'tenantId');
  const locationId = normalizeId(row.locationId ?? row.location_id, 'locationId');

  if (!tenantId) throw new TypeError(`${role} membership requires tenantId`);
  if (role === 'staff' && !locationId) throw new TypeError('staff membership requires locationId');
  if (role === 'owner' && locationId) {
    throw new TypeError('owner membership must be tenant-scoped, not location-scoped');
  }

  return Object.freeze({ role, tenantId, locationId });
}

function selectMembership(memberships, tenantId, locationId) {
  if (!tenantId) return null;

  const owner = memberships.find((item) => item.role === 'owner' && item.tenantId === tenantId);
  if (owner) return owner;

  if (!locationId) return null;
  return memberships.find(
    (item) => item.role === 'staff' && item.tenantId === tenantId && item.locationId === locationId
  ) || null;
}

/**
 * Read-only bridge between future membership storage and the pure authorization
 * contract. The loader is injected so this module cannot write to production
 * data and does not assume a database schema before the migration is designed.
 *
 * Legacy global roles are returned separately. They are never converted into
 * tenant/location membership and therefore cannot accidentally gain SaaS scope.
 */
export function createMembershipAuthorizationResolver({ loadMemberships }) {
  if (typeof loadMemberships !== 'function') {
    throw new TypeError('loadMemberships must be a function');
  }

  return async function resolveAuthorization({
    userId,
    platformRole = null,
    legacyRole = null,
    tenantId = null,
    locationId = null
  } = {}) {
    const normalizedUserId = normalizeId(userId, 'userId');
    const normalizedTenantId = normalizeId(tenantId, 'tenantId');
    const normalizedLocationId = normalizeId(locationId, 'locationId');

    if (normalizedLocationId && !normalizedTenantId) {
      throw new TypeError('locationId requires tenantId');
    }

    const legacyCapabilities = getLegacyRoleCapabilities(legacyRole);

    if (platformRole === 'platform_admin') {
      return Object.freeze({
        mode: 'scoped',
        context: createAuthorizationContext({ platformRole }),
        legacyCapabilities,
        membership: null
      });
    }

    if (!normalizedUserId) {
      return Object.freeze({
        mode: 'legacy',
        context: createAuthorizationContext(),
        legacyCapabilities,
        membership: null
      });
    }

    const loaded = await loadMemberships(normalizedUserId);
    if (!Array.isArray(loaded)) {
      throw new TypeError('loadMemberships must resolve to an array');
    }

    const memberships = loaded.map(normalizeMembership);
    const membership = selectMembership(memberships, normalizedTenantId, normalizedLocationId);

    if (!membership) {
      return Object.freeze({
        // Existing members and explicitly scoped requests cannot regain global
        // rights by omitting/changing their tenant or location.
        mode: memberships.length || normalizedTenantId || normalizedLocationId ? 'scoped' : 'legacy',
        context: createAuthorizationContext(),
        legacyCapabilities,
        membership: null
      });
    }

    return Object.freeze({
      mode: 'scoped',
      context: createAuthorizationContext({
        membershipRole: membership.role,
        tenantId: membership.tenantId,
        locationId: membership.locationId
      }),
      legacyCapabilities,
      membership
    });
  };
}
