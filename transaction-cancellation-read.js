import {
  buildTransactionReadPredicate,
  createMigrationGatedTransactionReadScope
} from './transaction-read-scope.js';

function requireDb(db) {
  if (!db || typeof db.query !== 'function') {
    throw new TypeError('db.query is required');
  }
}

function normalizeLookupValue(value, field) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new TypeError(`${field} is required`);
  }
  return String(value).trim();
}

function scopedWhere(scope, firstParameter = 2) {
  const predicate = buildTransactionReadPredicate(scope, {
    alias: 't',
    firstParameter
  });
  return {
    clause: predicate.sql ? ` AND ${predicate.sql}` : '',
    params: [...predicate.params]
  };
}

/**
 * Cancellation-specific transaction reads.
 *
 * Legacy mode intentionally emits the same global predicates used by the
 * existing route. Scoped mode is migration-gated and fail-closed: once enabled,
 * tenant/location predicates are mandatory for owner/staff authorization
 * contexts and are applied before FOR UPDATE locks are acquired.
 */
export function createTransactionCancellationRead({ scopedReadsEnabled = false } = {}) {
  const resolveScope = createMigrationGatedTransactionReadScope({ scopedReadsEnabled });

  function resolve(options = {}) {
    return resolveScope(options);
  }

  return Object.freeze({
    async findReplayForUpdate(db, requestKey, options = {}) {
      requireDb(db);
      const normalizedRequestKey = normalizeLookupValue(requestKey, 'requestKey');
      const scope = resolve(options);
      const scoped = scopedWhere(scope, 2);
      const result = await db.query(
        `SELECT t.* FROM transactions t WHERE t.cancel_request_key = $1${scoped.clause} FOR UPDATE`,
        [normalizedRequestKey, ...scoped.params]
      );
      return result.rows?.[0] ?? null;
    },

    async findCompletedByIdForUpdate(db, transactionId, options = {}) {
      requireDb(db);
      const normalizedTransactionId = normalizeLookupValue(transactionId, 'transactionId');
      const scope = resolve(options);
      const scoped = scopedWhere(scope, 2);
      const result = await db.query(
        `SELECT t.* FROM transactions t WHERE t.id = $1 AND t.status = 'completed'${scoped.clause} FOR UPDATE`,
        [normalizedTransactionId, ...scoped.params]
      );
      return result.rows?.[0] ?? null;
    }
  });
}

export const transactionCancellationReadContract = Object.freeze({
  defaultMode: 'legacy',
  scopedReadsEnabledByDefault: false,
  migration: '009_spaceverse_tenant_attribution.sql',
  replayLookupScoped: true,
  completedTransactionLookupScoped: true,
  lockScopeBeforeMutation: true,
  scopedFallbackToGlobal: false
});
