import { createMigrationGatedTransactionPersistence } from './transaction-persistence-compatibility.js';
import { createScopedTransactionPersistence } from './transaction-persistence.js';

function normalizeAdjustmentTransaction(transaction) {
  if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) {
    throw new TypeError('transaction must be an object');
  }
  if (String(transaction.mode || '') !== 'adjustment') {
    throw new TypeError('admin adjustment persistence requires adjustment mode');
  }
  if (String(transaction.status || '') !== 'completed') {
    throw new TypeError('admin adjustment persistence requires completed status');
  }
  return transaction;
}

/**
 * Persistence adapter for /api/admin/users/:id/adjust.
 *
 * Legacy mode deliberately preserves the existing SQL shape and database NOW()
 * semantics. Scoped mode is available only when the caller deliberately enables
 * it after migration 009 has been applied and verified; there is no fallback
 * from scoped mode to legacy persistence.
 */
export function createAdminAdjustmentPersistence({
  query,
  scopedWritesEnabled = false
} = {}) {
  if (typeof query !== 'function') throw new TypeError('query must be a function');

  const legacyInsert = async (rawTransaction) => {
    const transaction = normalizeAdjustmentTransaction(rawTransaction);
    const result = await query(
      `INSERT INTO transactions (
         request_key, client_id, staff_id, mode, status,
         bonus_spent, bonus_earned, balance_after, reason, completed_at
       ) VALUES ($1,$2,$3,'adjustment','completed',$4,$5,$6,$7,NOW())`,
      [
        transaction.request_key,
        transaction.client_id,
        transaction.staff_id,
        transaction.bonus_spent,
        transaction.bonus_earned,
        transaction.balance_after,
        transaction.reason
      ]
    );
    if (!result || typeof result !== 'object') {
      throw new TypeError('legacy adjustment insert must resolve to a query result object');
    }
    return Object.freeze({ rowCount: Number(result.rowCount || 0) });
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

export const adminAdjustmentPersistenceContract = Object.freeze({
  route: '/api/admin/users/:id/adjust',
  defaultMode: 'legacy',
  scopedWritesEnabledByDefault: false,
  preservesLegacySqlShape: true,
  preservesDatabaseNow: true,
  requiresMigration009BeforeScopedEnablement: true,
  scopedFallbackToLegacy: false
});
