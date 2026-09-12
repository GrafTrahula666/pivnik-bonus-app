import { canWriteLocation } from './authorization-context.js';

function normalizeRequiredId(value, field) {
  if (value === null || value === undefined || value === '') {
    throw new TypeError(`${field} is required`);
  }
  const normalized = String(value).trim();
  if (!normalized) throw new TypeError(`${field} must be a non-empty identifier`);
  return normalized;
}

/**
 * Resolve the immutable tenant/location attribution for a NEW transaction.
 *
 * Historical transactions are intentionally out of scope. This helper never
 * infers attribution from a user's legacy role or from existing transaction
 * data. The caller must supply an explicit target tenant/location and an
 * authorization context that is allowed to write that location.
 */
export function resolveTransactionAttribution({
  authorizationContext,
  tenantId,
  locationId
} = {}) {
  const normalizedTenantId = normalizeRequiredId(tenantId, 'tenantId');
  const normalizedLocationId = normalizeRequiredId(locationId, 'locationId');

  if (!authorizationContext || typeof authorizationContext !== 'object') {
    throw new TypeError('authorizationContext is required');
  }

  if (!canWriteLocation(authorizationContext, normalizedTenantId, normalizedLocationId)) {
    const error = new Error('Transaction scope is not authorized');
    error.code = 'TRANSACTION_SCOPE_FORBIDDEN';
    throw error;
  }

  return Object.freeze({
    tenantId: normalizedTenantId,
    locationId: normalizedLocationId,
    columns: Object.freeze({
      tenant_id: normalizedTenantId,
      location_id: normalizedLocationId
    })
  });
}

export const transactionAttributionContract = Object.freeze({
  appliesTo: 'new-transactions-only',
  requiredColumns: Object.freeze(['tenant_id', 'location_id']),
  historicalBackfill: false,
  requiresExplicitTenant: true,
  requiresExplicitLocation: true,
  derivesFromLegacyRole: false
});
