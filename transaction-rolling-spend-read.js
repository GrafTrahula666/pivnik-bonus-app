import {
  buildTransactionReadPredicate,
  createMigrationGatedTransactionReadScope
} from './transaction-read-scope.js';

function requireDb(db) {
  if (!db || typeof db.query !== 'function') {
    throw new TypeError('db.query is required');
  }
}

function normalizeUserId(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new TypeError('userId is required');
  }
  return String(value).trim();
}

function normalizeSpend(value) {
  const spend = Number(value ?? 0);
  if (!Number.isSafeInteger(spend) || spend < 0) {
    throw new TypeError('Rolling spend must be a non-negative safe integer');
  }
  return spend;
}

const LEGACY_SQL = `SELECT COALESCE(SUM(cash_paid_cents), 0)::bigint AS spend
     FROM transactions
     WHERE client_id = $1
       AND status = 'completed'
       AND mode IN ('accrue','redeem')
       AND created_at >= NOW() - INTERVAL '12 months'`;

/**
 * Read the same 12-month cash spend used by the current loyalty/status flow.
 *
 * Legacy mode intentionally preserves the current server.js SQL shape exactly.
 * Scoped mode adds tenant/location predicates only after migration 009 is
 * deliberately enabled; there is no scoped-to-global fallback.
 */
export function createTransactionRollingSpendRead({ scopedReadsEnabled = false } = {}) {
  const resolveScope = createMigrationGatedTransactionReadScope({ scopedReadsEnabled });

  return Object.freeze({
    async getRollingSpend(db, userId, options = {}) {
      requireDb(db);
      const normalizedUserId = normalizeUserId(userId);
      const scope = resolveScope(options);

      if (scope.level === 'legacy') {
        const result = await db.query(LEGACY_SQL, [normalizedUserId]);
        return normalizeSpend(result.rows?.[0]?.spend);
      }

      const predicate = buildTransactionReadPredicate(scope, {
        alias: 't',
        firstParameter: 2
      });
      const scopedClause = predicate.sql ? ` AND ${predicate.sql}` : '';
      const result = await db.query(
        `SELECT COALESCE(SUM(t.cash_paid_cents), 0)::bigint AS spend
         FROM transactions t
         WHERE t.client_id = $1
           AND t.status = 'completed'
           AND t.mode IN ('accrue','redeem')
           AND t.created_at >= NOW() - INTERVAL '12 months'${scopedClause}`,
        [normalizedUserId, ...predicate.params]
      );
      return normalizeSpend(result.rows?.[0]?.spend);
    }
  });
}

export const transactionRollingSpendReadContract = Object.freeze({
  defaultMode: 'legacy',
  scopedReadsEnabledByDefault: false,
  migration: '009_spaceverse_tenant_attribution.sql',
  period: '12 months',
  statuses: Object.freeze(['completed']),
  modes: Object.freeze(['accrue', 'redeem']),
  measure: 'cash_paid_cents',
  scopedFallbackToGlobal: false
});
