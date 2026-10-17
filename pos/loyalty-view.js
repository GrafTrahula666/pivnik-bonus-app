import { posError } from './scope.js';

/** A device may see only the wallet of the customer whose live QR it resolved.
 * Uses the same unlimited-balance policy as the serving application, never a
 * staff session, a supplied balance or a separately invented owner/role rule.
 */
export async function readPosLoyaltyView(db, clientId, policy) {
  if (!policy || typeof policy.isUnlimited !== 'function') {
    throw posError(503, 'pos_wallet_unavailable', 'Баланс клиента временно недоступен.');
  }
  const user = (await db.query(`SELECT u.id,u.telegram_id,u.role,u.unlimited_bonus,w.balance
    FROM users u JOIN wallets w ON w.user_id=u.id
    WHERE u.id=$1 AND u.deleted_at IS NULL AND u.merged_into_user_id IS NULL`, [clientId])).rows[0];
  if (!user) throw posError(503, 'pos_wallet_unavailable', 'Баланс клиента временно недоступен.');
  const unlimited = Boolean(policy.isUnlimited(user));
  const balance = Number(unlimited ? policy.unlimitedBalance : user.balance);
  if (!Number.isSafeInteger(balance) || balance < 0) {
    throw posError(503, 'pos_wallet_unavailable', 'Баланс клиента временно недоступен.');
  }
  return { balance, unlimited, pointsPerRuble: 1, maxSpendPercent: 30 };
}
