import { createMigrationGatedTransactionPersistence } from './transaction-persistence-compatibility.js';
import { createScopedTransactionPersistence } from './transaction-persistence.js';

function normalizeAchievementTransaction(transaction) {
  if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) {
    throw new TypeError('transaction must be an object');
  }
  if (String(transaction.mode || '') !== 'achievement') {
    throw new TypeError('achievement persistence requires achievement mode');
  }
  if (String(transaction.status || '') !== 'completed') {
    throw new TypeError('achievement persistence requires completed status');
  }
  return transaction;
}

/**
 * Migration-gated adapter for the achievement reward journal entry.
 *
 * The legacy branch deliberately preserves the current INSERT shape and
 * database-side NOW() timestamp. Scoped mode remains opt-in until migration
 * 009 is deliberately applied; once enabled there is no fallback to an
 * unattributed legacy transaction.
 */
export function createAchievementTransactionPersistence({
  query,
  scopedWritesEnabled = false
} = {}) {
  if (typeof query !== 'function') throw new TypeError('query must be a function');

  const legacyInsert = async (rawTransaction) => {
    const transaction = normalizeAchievementTransaction(rawTransaction);
    const result = await query(
      `INSERT INTO transactions (
         request_key, client_id, mode, status, bonus_earned,
         beer_gift_earned_ml, balance_after, reason, reward_code, completed_at
       ) VALUES (
         $1, $2::bigint, 'achievement', 'completed', $3::bigint,
         $4::bigint, $5::bigint, $6, $7, NOW()
       )`,
      [
        transaction.request_key,
        transaction.client_id,
        transaction.bonus_earned,
        transaction.beer_gift_earned_ml,
        transaction.balance_after,
        transaction.reason,
        transaction.reward_code
      ]
    );
    if (!result || !Array.isArray(result.rows)) {
      throw new TypeError('legacy achievement insert must resolve to an object with rows[]');
    }
    return null;
  };

  const scopedWriter = scopedWritesEnabled
    ? createScopedTransactionPersistence({ query })
    : undefined;

  const scopedInsert = scopedWriter
    ? async (options = {}) => {
        const transaction = normalizeAchievementTransaction(options.transaction);
        return scopedWriter({ ...options, transaction });
      }
    : undefined;

  return createMigrationGatedTransactionPersistence({
    legacyInsert,
    scopedInsert,
    scopedWritesEnabled
  });
}

export const achievementTransactionPersistenceContract = Object.freeze({
  source: 'achievement reward journal',
  mode: 'achievement',
  defaultMode: 'legacy',
  scopedWritesEnabledByDefault: false,
  preservesLegacySqlShape: true,
  preservesDatabaseNowInLegacyMode: true,
  requiresMigration009BeforeScopedEnablement: true,
  scopedFallbackToLegacy: false,
  changesRewardGrantAtomicity: false
});
