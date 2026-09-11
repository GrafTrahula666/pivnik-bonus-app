import { createMigrationGatedTransactionPersistence } from './transaction-persistence-compatibility.js';
import { createScopedTransactionPersistence } from './transaction-persistence.js';

const STAFF_TRANSACTION_MODES = new Set(['accrue', 'redeem']);

function normalizeStaffTransaction(transaction) {
  if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) {
    throw new TypeError('transaction must be an object');
  }
  const mode = String(transaction.mode || '');
  if (!STAFF_TRANSACTION_MODES.has(mode)) {
    throw new TypeError('staff transaction persistence requires accrue or redeem mode');
  }
  if (String(transaction.status || '') !== 'completed') {
    throw new TypeError('staff transaction persistence requires completed status');
  }
  return transaction;
}

/**
 * Persistence adapter for /api/staff/transactions.
 *
 * Legacy mode deliberately preserves the current INSERT shape, DB-side NOW()
 * timestamp and RETURNING * result. Scoped mode remains opt-in until migration
 * 009 has been deliberately applied and verified; there is no fallback from
 * scoped mode to legacy persistence.
 */
export function createStaffTransactionPersistence({
  query,
  scopedWritesEnabled = false
} = {}) {
  if (typeof query !== 'function') throw new TypeError('query must be a function');

  const legacyInsert = async (rawTransaction) => {
    const transaction = normalizeStaffTransaction(rawTransaction);
    const result = await query(
      `INSERT INTO transactions (
         request_key, client_id, staff_id, mode, status,
         check_amount_cents, discount_cents, bonus_spent, bonus_earned,
         cash_paid_cents, balance_after, is_suspicious,
         beer_ml, beer_gift_earned_ml, completed_at
       ) VALUES ($1,$2,$3,$4,'completed',$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
       RETURNING *`,
      [
        transaction.request_key,
        transaction.client_id,
        transaction.staff_id,
        transaction.mode,
        transaction.check_amount_cents,
        transaction.discount_cents,
        transaction.bonus_spent,
        transaction.bonus_earned,
        transaction.cash_paid_cents,
        transaction.balance_after,
        transaction.is_suspicious,
        transaction.beer_ml,
        transaction.beer_gift_earned_ml
      ]
    );
    if (!result || !Array.isArray(result.rows)) {
      throw new TypeError('legacy staff transaction insert must resolve to an object with rows[]');
    }
    if (result.rows.length !== 1) {
      throw new Error(`legacy staff transaction insert must return exactly one row, received ${result.rows.length}`);
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

export const staffTransactionPersistenceContract = Object.freeze({
  route: '/api/staff/transactions',
  modes: Object.freeze([...STAFF_TRANSACTION_MODES]),
  defaultMode: 'legacy',
  scopedWritesEnabledByDefault: false,
  preservesLegacySqlShape: true,
  preservesDatabaseNow: true,
  preservesReturningRow: true,
  requiresMigration009BeforeScopedEnablement: true,
  scopedFallbackToLegacy: false
});
