import {
  buildTransactionReadPredicate,
  createMigrationGatedTransactionReadScope
} from './transaction-read-scope.js';

function requireDb(db) {
  if (!db || typeof db.query !== 'function') {
    throw new TypeError('db.query is required');
  }
}

function normalizeStaffId(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new TypeError('staffId is required');
  }
  return String(value).trim();
}

function normalizeCountFrom(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('countFrom must be a valid date');
  }
  return date;
}

/**
 * Read only the cancellation count from transactions.
 *
 * The surrounding shift/reset logic remains deliberately outside this boundary:
 * shifts and cancel_quota_resets do not yet carry tenant/location attribution.
 * This prevents pretending the entire quota flow is tenant-safe before that
 * separate schema/design decision is made.
 */
export function createTransactionCancellationQuotaRead({ scopedReadsEnabled = false } = {}) {
  const resolveScope = createMigrationGatedTransactionReadScope({ scopedReadsEnabled });

  return Object.freeze({
    async countCancelledSince(db, staffId, countFrom, options = {}) {
      requireDb(db);
      const normalizedStaffId = normalizeStaffId(staffId);
      const normalizedCountFrom = normalizeCountFrom(countFrom);
      const scope = resolveScope(options);
      const predicate = buildTransactionReadPredicate(scope, {
        alias: 't',
        firstParameter: 3
      });
      const scopedClause = predicate.sql ? ` AND ${predicate.sql}` : '';
      const result = await db.query(
        `SELECT COUNT(*)::int AS count
         FROM transactions t
         WHERE t.cancelled_by = $1 AND t.cancelled_at >= $2${scopedClause}`,
        [normalizedStaffId, normalizedCountFrom, ...predicate.params]
      );
      const count = Number(result.rows?.[0]?.count ?? 0);
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new TypeError('Cancellation count must be a non-negative safe integer');
      }
      return count;
    }
  });
}

export const transactionCancellationQuotaReadContract = Object.freeze({
  defaultMode: 'legacy',
  scopedReadsEnabledByDefault: false,
  migration: '009_spaceverse_tenant_attribution.sql',
  cancellationCountScoped: true,
  shiftScopeHandled: false,
  resetScopeHandled: false,
  scopedFallbackToGlobal: false
});
