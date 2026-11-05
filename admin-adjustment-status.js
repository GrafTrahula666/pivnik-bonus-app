import { canManageTenant, canAccessLocation } from './authorization-context.js';
import { normalizeRequestKey } from './platform-core.js';

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}
function identifier(value, name, numeric = false) {
  if (typeof value !== 'string' && !(numeric && typeof value === 'number' && Number.isSafeInteger(value))) {
    throw new TypeError(`${name} must be an identifier`);
  }
  const id = String(value).trim();
  if (!id || id.length > 160) throw new TypeError(`${name} must be a bounded identifier`);
  if (numeric && (!/^[1-9]\d*$/.test(id) || BigInt(id) > 9223372036854775807n)) {
    throw new TypeError(`${name} must be a positive PostgreSQL bigint`);
  }
  return id;
}
function safeNonnegative(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}
const uncertain = state => Object.freeze({ state, canClearPending: false });

/**
 * Read-only recovery evidence for NEW tenant-attributed corrections.
 * Not wired into production. Requires verified migration 009 and a server-
 * resolved authorization context. authenticatedActorId must come from the
 * authenticated session, never the command/body. Legacy admin rights are not
 * tenant membership. Even platform admins may recover only their own command.
 * A missing row cannot prove non-commit (in-flight writes/replica lag/legacy
 * attribution); it must never authorize replacement of the original key.
 */
export function createAdminAdjustmentStatusReader({ query, scopedReadsEnabled = false } = {}) {
  if (typeof query !== 'function') throw new TypeError('query must be a function');
  if (typeof scopedReadsEnabled !== 'boolean') throw new TypeError('scopedReadsEnabled must be boolean');
  return async function readAdjustmentStatus({ authorizationContext, authenticatedActorId,
    tenantId, locationId, clientId, command } = {}) {
    if (!scopedReadsEnabled) throw failure('ADJUSTMENT_STATUS_UNAVAILABLE', 'Scoped status reads are not enabled');
    const tenant = identifier(tenantId, 'tenantId');
    const location = identifier(locationId, 'locationId');
    if (!canManageTenant(authorizationContext, tenant) || !canAccessLocation(authorizationContext, tenant, location)) {
      throw failure('ADJUSTMENT_STATUS_FORBIDDEN', 'Correction status scope is not authorized');
    }
    const actor = identifier(authenticatedActorId, 'authenticatedActorId', true);
    const target = identifier(clientId, 'clientId', true);
    if (!command || !Number.isSafeInteger(command.amount) || command.amount === 0 ||
        typeof command.reason !== 'string' || !command.reason.trim() || command.reason.length > 8192 ||
        typeof command.requestKey !== 'string' || !normalizeRequestKey(command.requestKey)) {
      throw new TypeError('A valid original correction command is required');
    }
    const key = normalizeRequestKey(command.requestKey), reason = command.reason.trim();
    const result = await query(
      `SELECT id, tenant_id, location_id, client_id, staff_id, request_key,
              mode, status, bonus_earned, bonus_spent, balance_after, reason
       FROM transactions
       WHERE tenant_id = $1 AND location_id = $2 AND staff_id = $3::bigint
         AND client_id = $4::bigint AND request_key = $5
       LIMIT 2`, [tenant, location, actor, target, key]);
    if (!result || !Array.isArray(result.rows) || result.rows.length > 1) {
      throw failure('ADJUSTMENT_STATUS_INVALID_RESULT', 'Status query must return at most one row');
    }
    if (!result.rows.length) return uncertain('unknown');
    const row = result.rows[0];
    // Recheck returned boundaries as well as parameterized SQL predicates.
    if (!row || row.tenant_id !== tenant || row.location_id !== location ||
        String(row.staff_id) !== actor || String(row.client_id) !== target || row.request_key !== key) {
      throw failure('ADJUSTMENT_STATUS_INVALID_RESULT', 'Status query returned an out-of-scope row');
    }
    const earned = safeNonnegative(row.bonus_earned), spent = safeNonnegative(row.bonus_spent);
    if (earned === null || spent === null) throw failure('ADJUSTMENT_STATUS_INVALID_RESULT', 'Invalid journal amounts');
    if (row.mode !== 'adjustment' || earned !== Math.max(command.amount, 0) ||
        spent !== Math.max(-command.amount, 0) || row.reason !== reason) return uncertain('conflict');
    if (row.status === 'cancelled') return uncertain('cancelled');
    if (row.status !== 'completed') return uncertain('unknown');
    const balanceAfter = safeNonnegative(row.balance_after);
    if (balanceAfter === null) throw failure('ADJUSTMENT_STATUS_INVALID_RESULT', 'Invalid journal balance');
    return Object.freeze({ state: 'confirmed', canClearPending: true,
      transactionId: identifier(row.id, 'transactionId', true), balanceAfter });
  };
}

export const adminAdjustmentStatusContract = Object.freeze({
  productionWiringEnabled: false, requiresMigration009: true,
  derivesScopeFromLegacyRole: false, readOnly: true,
  missingRowProvesNonCommit: false, allowsNewKeyOnUnknown: false,
  currentWalletBalanceIncluded: false, historicalBackfill: false
});
