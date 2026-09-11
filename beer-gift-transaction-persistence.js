import { createMigrationGatedTransactionPersistence } from './transaction-persistence-compatibility.js';
import { createScopedTransactionPersistence } from './transaction-persistence.js';

function normalizeBeerGiftTransaction(transaction) {
  if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) {
    throw new TypeError('transaction must be an object');
  }
  if (String(transaction.mode || '') !== 'beer_gift') {
    throw new TypeError('beer gift transaction persistence requires beer_gift mode');
  }
  if (String(transaction.status || '') !== 'completed') {
    throw new TypeError('beer gift transaction persistence requires completed status');
  }
  return transaction;
}

/**
 * Persistence adapter for /api/staff/beer-gift.
 *
 * Legacy mode deliberately preserves the current INSERT shape, DB-side NOW()
 * timestamp and RETURNING * result. Scoped mode stays opt-in until migration
 * 009 has been deliberately applied and verified. Once enabled, there is no
 * fallback to unattributed legacy persistence.
 */
export function createBeerGiftTransactionPersistence({
  query,
  scopedWritesEnabled = false
} = {}) {
  if (typeof query !== 'function') throw new TypeError('query must be a function');

  const legacyInsert = async (rawTransaction) => {
    const transaction = normalizeBeerGiftTransaction(rawTransaction);
    const result = await query(
      `INSERT INTO transactions (
         request_key, client_id, staff_id, mode, status,
         check_amount_cents, cash_paid_cents, balance_after,
         beer_gift_spent_ml, reason, completed_at
       ) VALUES ($1,$2,$3,'beer_gift','completed',0,0,$4,$5,$6,NOW())
       RETURNING *`,
      [
        transaction.request_key,
        transaction.client_id,
        transaction.staff_id,
        transaction.balance_after,
        transaction.beer_gift_spent_ml,
        transaction.reason
      ]
    );
    if (!result || !Array.isArray(result.rows)) {
      throw new TypeError('legacy beer gift transaction insert must resolve to an object with rows[]');
    }
    if (result.rows.length !== 1) {
      throw new Error(`legacy beer gift transaction insert must return exactly one row, received ${result.rows.length}`);
    }
    return Object.freeze({ ...result.rows[0] });
  };

  const scopedInsert = scopedWritesEnabled
    ? createScopedTransactionPersistence({ query })
    : undefined;

  return createMigrationGatedTransactionPersistence({
    legacyInsert,
    scopedInsert,
    scopedWritesEnabled
  });
}

export const beerGiftTransactionPersistenceContract = Object.freeze({
  route: '/api/staff/beer-gift',
  mode: 'beer_gift',
  defaultMode: 'legacy',
  scopedWritesEnabledByDefault: false,
  preservesLegacySqlShape: true,
  preservesDatabaseNow: true,
  preservesReturningRow: true,
  requiresMigration009BeforeScopedEnablement: true,
  scopedFallbackToLegacy: false
});
