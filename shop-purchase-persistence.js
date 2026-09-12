import { createMigrationGatedTransactionPersistence } from './transaction-persistence-compatibility.js';
import { createScopedTransactionPersistence } from './transaction-persistence.js';

function normalizeShopTransaction(transaction) {
  if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) {
    throw new TypeError('transaction must be an object');
  }
  if (String(transaction.mode || '') !== 'shop') {
    throw new TypeError('shop purchase persistence requires shop mode');
  }
  if (String(transaction.status || '') !== 'completed') {
    throw new TypeError('shop purchase persistence requires completed status');
  }
  return transaction;
}

/**
 * Persistence adapter for /api/staff/shop/purchase.
 *
 * Legacy mode preserves the existing INSERT, DB-side NOW() timestamp and
 * RETURNING * result because the route immediately serializes that row.
 * Scoped mode remains opt-in and fail-closed until migration 009 is applied.
 */
export function createShopPurchasePersistence({
  query,
  scopedWritesEnabled = false
} = {}) {
  if (typeof query !== 'function') throw new TypeError('query must be a function');

  const legacyInsert = async (rawTransaction) => {
    const transaction = normalizeShopTransaction(rawTransaction);
    const result = await query(
      `INSERT INTO transactions (request_key, client_id, staff_id, mode, status, bonus_spent, balance_after, reason, completed_at)
       VALUES ($1,$2,$3,'shop','completed',$4,$5,$6,NOW()) RETURNING *`,
      [
        transaction.request_key,
        transaction.client_id,
        transaction.staff_id,
        transaction.bonus_spent,
        transaction.balance_after,
        transaction.reason
      ]
    );
    if (!result || !Array.isArray(result.rows)) {
      throw new TypeError('legacy shop insert must resolve to an object with rows[]');
    }
    if (result.rows.length !== 1) {
      throw new Error(`legacy shop insert must return exactly one row, received ${result.rows.length}`);
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

export const shopPurchasePersistenceContract = Object.freeze({
  route: '/api/staff/shop/purchase',
  defaultMode: 'legacy',
  scopedWritesEnabledByDefault: false,
  preservesLegacySqlShape: true,
  preservesDatabaseNow: true,
  preservesReturningRow: true,
  requiresMigration009BeforeScopedEnablement: true,
  scopedFallbackToLegacy: false
});
