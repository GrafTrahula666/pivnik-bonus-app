import { canAccessLocation, canAccessTenant } from './authorization-context.js';

function normalizeOptionalId(value, field) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim();
  if (!normalized) throw new TypeError(`${field} must be a non-empty identifier`);
  return normalized;
}

function forbidden() {
  return Object.assign(new Error('Transaction read scope is not authorized'), {
    code: 'TRANSACTION_READ_SCOPE_FORBIDDEN'
  });
}

/**
 * Resolve the narrowest transaction read scope an authorization context may use.
 *
 * platform_admin may read globally, by tenant, or by location.
 * owner is always tenant-bound and may optionally narrow to one location.
 * staff is always bound to its explicit tenant/location membership.
 *
 * Legacy users.role values are intentionally not accepted here. Callers must
 * provide the explicit SPACEVERSE authorization context.
 */
export function resolveTransactionReadScope({
  authorizationContext,
  tenantId = null,
  locationId = null
} = {}) {
  if (!authorizationContext || typeof authorizationContext !== 'object') {
    throw new TypeError('authorizationContext is required');
  }

  const targetTenantId = normalizeOptionalId(tenantId, 'tenantId');
  const targetLocationId = normalizeOptionalId(locationId, 'locationId');
  if (targetLocationId && !targetTenantId) {
    throw new TypeError('locationId requires tenantId');
  }

  if (authorizationContext.platformRole === 'platform_admin') {
    if (!targetTenantId) {
      return Object.freeze({ level: 'platform', tenantId: null, locationId: null });
    }
    if (targetLocationId) {
      if (!canAccessLocation(authorizationContext, targetTenantId, targetLocationId)) throw forbidden();
      return Object.freeze({ level: 'location', tenantId: targetTenantId, locationId: targetLocationId });
    }
    if (!canAccessTenant(authorizationContext, targetTenantId)) throw forbidden();
    return Object.freeze({ level: 'tenant', tenantId: targetTenantId, locationId: null });
  }

  const memberTenantId = normalizeOptionalId(authorizationContext.tenantId, 'authorizationContext.tenantId');
  if (!memberTenantId) throw forbidden();
  const resolvedTenantId = targetTenantId || memberTenantId;
  if (!canAccessTenant(authorizationContext, resolvedTenantId)) throw forbidden();

  if (authorizationContext.membershipRole === 'owner') {
    if (!targetLocationId) {
      return Object.freeze({ level: 'tenant', tenantId: resolvedTenantId, locationId: null });
    }
    if (!canAccessLocation(authorizationContext, resolvedTenantId, targetLocationId)) throw forbidden();
    return Object.freeze({ level: 'location', tenantId: resolvedTenantId, locationId: targetLocationId });
  }

  if (authorizationContext.membershipRole === 'staff') {
    const memberLocationId = normalizeOptionalId(
      authorizationContext.locationId,
      'authorizationContext.locationId'
    );
    if (!memberLocationId) throw forbidden();
    const resolvedLocationId = targetLocationId || memberLocationId;
    if (!canAccessLocation(authorizationContext, resolvedTenantId, resolvedLocationId)) throw forbidden();
    return Object.freeze({
      level: 'location',
      tenantId: resolvedTenantId,
      locationId: resolvedLocationId
    });
  }

  throw forbidden();
}

function hasExplicitScopedRead(options = {}) {
  return Boolean(
    options.authorizationContext
    || options.tenantId !== undefined
    || options.locationId !== undefined
  );
}

/**
 * Keep transaction reads on legacy SQL until migration 009 is deliberately
 * enabled. Once scoped reads are enabled, there is no fallback to a global read.
 */
export function createMigrationGatedTransactionReadScope({ scopedReadsEnabled = false } = {}) {
  if (typeof scopedReadsEnabled !== 'boolean') throw new TypeError('scopedReadsEnabled must be boolean');
  return function resolve(options = {}) {
    if (!scopedReadsEnabled) {
      if (hasExplicitScopedRead(options)) {
        throw Object.assign(
          new Error('Scoped transaction reads are migration-gated'),
          { code: 'TRANSACTION_READ_SCOPE_MIGRATION_GATED' }
        );
      }
      return Object.freeze({ level: 'legacy', tenantId: null, locationId: null });
    }
    return resolveTransactionReadScope(options);
  };
}

export function buildTransactionReadPredicate(scope, { alias = 't', firstParameter = 1 } = {}) {
  if (!scope || typeof scope !== 'object') throw new TypeError('scope is required');
  if (!Number.isSafeInteger(firstParameter) || firstParameter < 1) {
    throw new TypeError('firstParameter must be a positive safe integer');
  }
  const safeAlias = String(alias || '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(safeAlias)) throw new TypeError('alias is invalid');

  if (scope.level === 'legacy' || scope.level === 'platform') {
    return Object.freeze({ sql: '', params: Object.freeze([]) });
  }
  if (scope.level === 'tenant') {
    if (!normalizeOptionalId(scope.tenantId, 'tenantId')) throw new TypeError('tenantId is required');
    if (scope.locationId) throw new TypeError('tenant scope cannot contain locationId');
    return Object.freeze({
      sql: `${safeAlias}.tenant_id = $${firstParameter}`,
      params: Object.freeze([scope.tenantId])
    });
  }
  if (scope.level === 'location') {
    if (!normalizeOptionalId(scope.tenantId, 'tenantId')) throw new TypeError('tenantId is required');
    if (!normalizeOptionalId(scope.locationId, 'locationId')) throw new TypeError('locationId is required');
    return Object.freeze({
      sql: `${safeAlias}.tenant_id = $${firstParameter} AND ${safeAlias}.location_id = $${firstParameter + 1}`,
      params: Object.freeze([scope.tenantId, scope.locationId])
    });
  }
  throw new TypeError(`Unknown transaction read scope level: ${scope.level}`);
}

export const transactionReadScopeContract = Object.freeze({
  defaultMode: 'legacy',
  scopedReadsEnabledByDefault: false,
  migration: '009_spaceverse_tenant_attribution.sql',
  platformAdminMayReadGlobally: true,
  ownerDefaultScope: 'tenant',
  staffDefaultScope: 'location',
  legacyRoleInference: false,
  scopedFallbackToGlobal: false
});
