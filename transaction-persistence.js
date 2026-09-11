import { resolveTransactionAttribution } from './transaction-attribution.js';

const TRANSACTION_MODES = new Set([
  'accrue',
  'redeem',
  'adjustment',
  'beer_gift',
  'welcome',
  'shop',
  'achievement'
]);

const WRITABLE_COLUMNS = Object.freeze([
  'request_key',
  'client_id',
  'staff_id',
  'mode',
  'status',
  'check_amount_cents',
  'discount_cents',
  'bonus_spent',
  'bonus_earned',
  'cash_paid_cents',
  'balance_after',
  'reason',
  'reward_code',
  'expires_at',
  'completed_at',
  'is_suspicious',
  'beer_ml',
  'beer_gift_earned_ml',
  'beer_gift_spent_ml'
]);

function normalizeTransaction(transaction) {
  if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) {
    throw new TypeError('transaction must be an object');
  }

  const unknown = Object.keys(transaction).filter((column) => !WRITABLE_COLUMNS.includes(column));
  if (unknown.length) {
    throw new TypeError(`Unsupported transaction column: ${unknown[0]}`);
  }

  const mode = String(transaction.mode || '').trim();
  if (!TRANSACTION_MODES.has(mode)) {
    throw new TypeError(`Unsupported transaction mode: ${mode || '<empty>'}`);
  }

  if (transaction.client_id === null || transaction.client_id === undefined || transaction.client_id === '') {
    throw new TypeError('transaction.client_id is required');
  }

  return Object.freeze({ ...transaction, mode });
}

/**
 * Persistence boundary for NEW SPACEVERSE-attributed transactions.
 *
 * It deliberately cannot infer tenant/location from legacy user roles or from
 * historical transactions. The caller supplies an authorization context plus
 * an explicit target tenant/location. SQL identifiers come only from the fixed
 * allow-list above; all values are parameterized.
 *
 * This helper is not wired into production until the additive attribution
 * migration is deliberately applied and verified.
 */
export function createScopedTransactionPersistence({ query }) {
  if (typeof query !== 'function') throw new TypeError('query must be a function');

  return async function insertNewTransaction({
    authorizationContext,
    tenantId,
    locationId,
    transaction
  } = {}) {
    const attribution = resolveTransactionAttribution({
      authorizationContext,
      tenantId,
      locationId
    });
    const normalized = normalizeTransaction(transaction);

    const columns = [];
    const values = [];
    for (const column of WRITABLE_COLUMNS) {
      if (!Object.prototype.hasOwnProperty.call(normalized, column)) continue;
      columns.push(column);
      values.push(normalized[column]);
    }

    columns.push('tenant_id', 'location_id');
    values.push(attribution.tenantId, attribution.locationId);

    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
    const sql = `INSERT INTO transactions (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`;
    const result = await query(sql, values);

    if (!result || !Array.isArray(result.rows)) {
      throw new TypeError('transaction insert must resolve to an object with rows[]');
    }
    if (result.rows.length !== 1) {
      throw new Error(`transaction insert must return exactly one row, received ${result.rows.length}`);
    }

    return Object.freeze({ ...result.rows[0] });
  };
}

export const transactionPersistenceContract = Object.freeze({
  appliesTo: 'new-transactions-only',
  table: 'transactions',
  modes: Object.freeze([...TRANSACTION_MODES]),
  writableColumns: WRITABLE_COLUMNS,
  requiredScopeColumns: Object.freeze(['tenant_id', 'location_id']),
  parameterizedValuesOnly: true,
  historicalBackfill: false,
  productionWiringEnabled: false
});
