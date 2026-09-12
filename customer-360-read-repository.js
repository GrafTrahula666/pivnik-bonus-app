import {
  buildTransactionReadPredicate,
  createMigrationGatedTransactionReadScope
} from './transaction-read-scope.js';

function requireDb(db) {
  if (!db || typeof db.query !== 'function') throw new TypeError('db.query is required');
}

function normalizeCustomerId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError('customerId must be a positive safe integer');
  return id;
}

function toSafeInteger(value, field) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number)) throw new TypeError(`${field} must be a safe integer`);
  return number;
}

function nullableIso(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('Invalid timestamp returned by Customer 360 query');
  return date.toISOString();
}

/**
 * Read-only Customer 360 foundation.
 *
 * The historical users table is global and has no tenant_id/location_id. In
 * scoped mode this repository therefore proves customer visibility through a
 * transaction that belongs to the authorized scope BEFORE reading global user
 * identity fields. This avoids an ID-enumeration leak across tenants.
 *
 * Until migration 009 is deliberately enabled, legacy mode preserves the
 * current single-business behaviour and does not accept explicit scope.
 */
export function createCustomer360ReadRepository({ scopedReadsEnabled = false } = {}) {
  const resolveScope = createMigrationGatedTransactionReadScope({ scopedReadsEnabled });

  async function assertScopedCustomerVisible(db, customerId, scope) {
    if (scope.level === 'legacy' || scope.level === 'platform') return true;

    const predicate = buildTransactionReadPredicate(scope, { alias: 't', firstParameter: 2 });
    const result = await db.query(
      `SELECT 1
       FROM transactions t
       WHERE t.client_id = $1
         AND ${predicate.sql}
       LIMIT 1`,
      [customerId, ...predicate.params]
    );
    return Boolean(result.rows?.[0]);
  }

  async function getIdentityAndBalances(db, customerId) {
    const result = await db.query(
      `SELECT u.id, u.username, u.first_name, u.last_name, u.created_at,
              u.photo_url, u.profile_frame,
              COALESCE(w.balance, 0)::bigint AS bonus_balance,
              COALESCE(bl.paid_ml_total, 0)::bigint AS paid_ml_total,
              COALESCE(bl.gift_ml_balance, 0)::bigint AS gift_ml_balance
       FROM users u
       LEFT JOIN wallets w ON w.user_id = u.id
       LEFT JOIN beer_loyalty bl ON bl.user_id = u.id
       WHERE u.id = $1
         AND u.deleted_at IS NULL
       LIMIT 1`,
      [customerId]
    );
    const row = result.rows?.[0];
    if (!row) return null;
    return Object.freeze({
      id: Number(row.id),
      username: row.username ?? null,
      firstName: row.first_name ?? null,
      lastName: row.last_name ?? null,
      createdAt: nullableIso(row.created_at),
      photoUrl: row.photo_url ?? null,
      profileFrame: row.profile_frame ?? null,
      bonusBalance: toSafeInteger(row.bonus_balance, 'bonus_balance'),
      paidMlTotal: toSafeInteger(row.paid_ml_total, 'paid_ml_total'),
      giftMlBalance: toSafeInteger(row.gift_ml_balance, 'gift_ml_balance')
    });
  }

  async function getFinancialSummary(db, customerId, scope) {
    const predicate = buildTransactionReadPredicate(scope, { alias: 't', firstParameter: 2 });
    const scopedClause = predicate.sql ? ` AND ${predicate.sql}` : '';
    const result = await db.query(
      `SELECT
         COALESCE(SUM(CASE WHEN t.status = 'completed' AND t.mode IN ('accrue','redeem') THEN t.cash_paid_cents ELSE 0 END), 0)::bigint AS cash_paid_cents,
         COALESCE(SUM(CASE WHEN t.status = 'completed' THEN t.bonus_earned ELSE 0 END), 0)::bigint AS bonus_credited,
         COALESCE(SUM(CASE WHEN t.status = 'completed' THEN t.bonus_spent ELSE 0 END), 0)::bigint AS bonus_debited,
         COUNT(*) FILTER (WHERE t.status = 'completed')::bigint AS completed_operations,
         MAX(t.created_at) FILTER (WHERE t.status = 'completed') AS last_activity_at
       FROM transactions t
       WHERE t.client_id = $1${scopedClause}`,
      [customerId, ...predicate.params]
    );
    const row = result.rows?.[0] || {};
    return Object.freeze({
      cashPaidCents: toSafeInteger(row.cash_paid_cents, 'cash_paid_cents'),
      bonusCredited: toSafeInteger(row.bonus_credited, 'bonus_credited'),
      bonusDebited: toSafeInteger(row.bonus_debited, 'bonus_debited'),
      completedOperations: toSafeInteger(row.completed_operations, 'completed_operations'),
      lastActivityAt: nullableIso(row.last_activity_at)
    });
  }

  return Object.freeze({
    async getCustomerSummary(db, customerId, options = {}) {
      requireDb(db);
      const normalizedCustomerId = normalizeCustomerId(customerId);
      const scope = resolveScope(options);

      const visible = await assertScopedCustomerVisible(db, normalizedCustomerId, scope);
      if (!visible) return null;

      const identity = await getIdentityAndBalances(db, normalizedCustomerId);
      if (!identity) return null;

      const financial = await getFinancialSummary(db, normalizedCustomerId, scope);
      return Object.freeze({ identity, financial });
    }
  });
}

export const customer360ReadRepositoryContract = Object.freeze({
  readOnly: true,
  defaultMode: 'legacy',
  scopedReadsEnabledByDefault: false,
  migration: '009_spaceverse_tenant_attribution.sql',
  scopedCustomerVisibility: 'transaction-footprint-first',
  globalUserIdentityReadRequiresPriorScopedVisibility: true,
  scopedFallbackToGlobal: false,
  exposesSensitiveAuthFields: false,
  syntheticMetrics: false
});
