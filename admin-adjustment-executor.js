import { createAdminAdjustmentPersistence } from './admin-adjustment-persistence.js';

function normalizeIdentifier(value, field) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new TypeError(`${field} is required`);
  }
  return String(value).trim();
}

function normalizeAmount(value) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount === 0) {
    throw new TypeError('amount must be a non-zero safe integer');
  }
  return amount;
}

function normalizeReason(value) {
  const reason = String(value || '').trim();
  if (!reason) throw new TypeError('reason is required');
  return reason;
}

function createHttpLikeError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

/**
 * Atomic executor for the existing manual bonus-adjustment flow.
 *
 * It deliberately preserves the current lock order and persistence boundary:
 * BEGIN -> request-key lock -> user lock -> wallet lock -> replay check ->
 * wallet mutation -> transaction journal -> COMMIT.
 *
 * HTTP concerns stay outside this module. Customer 360 and the legacy admin
 * route can therefore share exactly one financial mutation implementation.
 */
export function createAdminAdjustmentExecutor({
  pool,
  lockRequestKey,
  assertMatchingTransaction,
  createPersistence = createAdminAdjustmentPersistence
} = {}) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('pool.connect is required');
  if (typeof lockRequestKey !== 'function') throw new TypeError('lockRequestKey must be a function');
  if (typeof assertMatchingTransaction !== 'function') {
    throw new TypeError('assertMatchingTransaction must be a function');
  }
  if (typeof createPersistence !== 'function') throw new TypeError('createPersistence must be a function');

  return async function executeAdminAdjustment({
    customerId,
    actorId,
    amount,
    reason,
    requestKey
  } = {}) {
    const normalizedCustomerId = normalizeIdentifier(customerId, 'customerId');
    const normalizedActorId = normalizeIdentifier(actorId, 'actorId');
    const normalizedRequestKey = normalizeIdentifier(requestKey, 'requestKey');
    const normalizedAmount = normalizeAmount(amount);
    const normalizedReason = normalizeReason(reason);

    const client = await pool.connect();
    let transactionOpen = false;

    try {
      await client.query('BEGIN');
      transactionOpen = true;
      await lockRequestKey(client, normalizedRequestKey);

      const targetResult = await client.query(
        `SELECT id, telegram_id, role, unlimited_bonus
         FROM users
         WHERE id = $1::bigint AND merged_into_user_id IS NULL
         FOR UPDATE`,
        [normalizedCustomerId]
      );
      const walletResult = await client.query(
        'SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE',
        [normalizedCustomerId]
      );

      if (!targetResult.rowCount || !walletResult.rowCount) {
        throw createHttpLikeError('Пользователь не найден.', 404, 'customer_not_found');
      }

      const targetUser = targetResult.rows[0];
      const existing = await client.query(
        'SELECT * FROM transactions WHERE request_key = $1',
        [normalizedRequestKey]
      );

      if (existing.rowCount) {
        const replay = existing.rows[0];
        assertMatchingTransaction(replay, {
          clientId: targetUser.id,
          staffId: normalizedActorId,
          mode: 'adjustment',
          adjustmentAmount: normalizedAmount,
          reason: normalizedReason
        });
        await client.query('COMMIT');
        transactionOpen = false;
        return Object.freeze({
          ok: true,
          replayed: true,
          transaction: replay,
          customerId: String(targetUser.id),
          balanceAfter: Number(replay.balance_after ?? walletResult.rows[0].balance ?? 0)
        });
      }

      const oldBalance = Number(walletResult.rows[0].balance || 0);
      if (!Number.isSafeInteger(oldBalance)) {
        throw createHttpLikeError('Некорректный бонусный баланс клиента.', 409, 'unsafe_balance');
      }
      const newBalance = oldBalance + normalizedAmount;
      if (!Number.isSafeInteger(newBalance)) {
        throw createHttpLikeError('Результирующий бонусный баланс выходит за безопасный диапазон.', 409, 'unsafe_balance');
      }
      if (newBalance < 0) {
        throw createHttpLikeError('Баланс не может стать отрицательным.', 400, 'negative_balance');
      }

      await client.query(
        'UPDATE wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2',
        [newBalance, normalizedCustomerId]
      );

      const persistAdjustment = createPersistence({ query: client.query.bind(client) });
      await persistAdjustment({
        transaction: {
          request_key: normalizedRequestKey,
          client_id: normalizedCustomerId,
          staff_id: normalizedActorId,
          mode: 'adjustment',
          status: 'completed',
          bonus_spent: normalizedAmount < 0 ? Math.abs(normalizedAmount) : 0,
          bonus_earned: normalizedAmount > 0 ? normalizedAmount : 0,
          balance_after: newBalance,
          reason: normalizedReason
        }
      });

      await client.query('COMMIT');
      transactionOpen = false;
      return Object.freeze({
        ok: true,
        replayed: false,
        customerId: String(targetUser.id),
        balanceBefore: oldBalance,
        balanceAfter: newBalance
      });
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Preserve the original failure. A rollback failure is operationally
          // significant, but replacing the original error would obscure cause.
        }
      }
      throw error;
    } finally {
      client.release();
    }
  };
}

export const adminAdjustmentExecutorContract = Object.freeze({
  atomic: true,
  lockOrder: Object.freeze([
    'request_key',
    'user',
    'wallet',
    'replay',
    'wallet_mutation',
    'journal'
  ]),
  reusesAdminAdjustmentPersistence: true,
  preservesIdempotentReplayValidation: true,
  rejectsNegativeResult: true,
  rejectsUnsafeIntegerBalances: true,
  ownsHttpResponse: false,
  productionRouteWired: false
});
