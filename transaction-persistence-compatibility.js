function hasExplicitScope({ authorizationContext, tenantId, locationId } = {}) {
  return Boolean(
    authorizationContext
    || tenantId !== undefined
    || locationId !== undefined
  );
}

/**
 * Migration gate between the current legacy transaction writers and the future
 * SPACEVERSE scoped writer.
 *
 * Before the tenant-attribution migration is deliberately applied, callers can
 * keep using the existing legacy INSERT without touching production schema or
 * data. Once scoped writes are enabled, there is deliberately no fallback to
 * legacy persistence: missing tenant/location authorization must fail closed in
 * the scoped writer instead of silently creating an unattributed transaction.
 */
export function createMigrationGatedTransactionPersistence({
  legacyInsert,
  scopedInsert,
  scopedWritesEnabled = false
} = {}) {
  if (typeof scopedWritesEnabled !== 'boolean') throw new TypeError('scopedWritesEnabled must be boolean');
  if (typeof legacyInsert !== 'function') {
    throw new TypeError('legacyInsert must be a function');
  }
  if (scopedWritesEnabled && typeof scopedInsert !== 'function') {
    throw new TypeError('scopedInsert must be a function when scoped writes are enabled');
  }

  return async function persistTransaction(options = {}) {
    if (!scopedWritesEnabled) {
      if (hasExplicitScope(options)) {
        throw Object.assign(
          new Error('Scoped transaction persistence is migration-gated'),
          { code: 'TRANSACTION_SCOPE_MIGRATION_GATED' }
        );
      }
      return legacyInsert(options.transaction);
    }

    return scopedInsert(options);
  };
}

export const transactionPersistenceCompatibilityContract = Object.freeze({
  defaultMode: 'legacy',
  scopedWritesEnabledByDefault: false,
  legacyAcceptsTenantScope: false,
  scopedFallbackToLegacy: false,
  requiresDeliberateMigrationEnablement: true
});
