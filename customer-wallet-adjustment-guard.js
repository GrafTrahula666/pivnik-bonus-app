import { REQUEST_KEY_PATTERN } from './platform-core.js';

function unavailable() {
  return Object.assign(new Error('Authoritative wallet binding is not enabled'), { code: 'WALLET_BINDING_UNAVAILABLE' });
}
function id(value, field) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || BigInt(value) > 9223372036854775807n) {
    throw new TypeError(`${field} must be a canonical positive bigint string`);
  }
  return value;
}
function scope(value, field) {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 160) {
    throw new TypeError(`${field} must be a bounded scope identifier`);
  }
  return value;
}
function normalize(command) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) throw new TypeError('command is required');
  const customerId = id(command.customerId, 'customerId'), actorId = id(command.actorId, 'actorId');
  const tenantId = scope(command.tenantId, 'tenantId'), locationId = scope(command.locationId, 'locationId');
  if (!Number.isSafeInteger(command.amount) || command.amount === 0) throw new TypeError('amount must be a non-zero safe integer');
  if (typeof command.reason !== 'string' || !command.reason.trim() || command.reason.length > 500) throw new TypeError('reason is required');
  if (typeof command.requestKey !== 'string' || !REQUEST_KEY_PATTERN.test(command.requestKey)) throw new TypeError('requestKey is invalid');
  return Object.freeze({ customerId, actorId, tenantId, locationId, amount: command.amount,
    reason: command.reason, requestKey: command.requestKey,
    audit: Object.freeze({ action: 'bonus.adjust', customerId, actorId, tenantId, locationId,
      reason: command.reason, requestKey: command.requestKey }) });
}

/**
 * Optional executor boundary for the existing Customer 360 executeAdjustment hook.
 * Unmounted/default-disabled. It supplies neither ownership SQL nor actor auth.
 * Trusted composition must bind the actor and verify fresh manager rights first.
 * runInTransaction must BEGIN/COMMIT/ROLLBACK; assertWalletOwned must use that SAME
 * transaction and lock authoritative binding against concurrent revocation.
 * executeAdjustment must reuse the supplied transaction, including replay checks.
 * A transaction footprint, metadata or caller assertion is never ownership proof.
 */
export function createCustomerWalletAdjustmentGuard({
  runInTransaction, assertWalletOwned, executeAdjustment, walletBindingEnabled = false
} = {}) {
  if (typeof walletBindingEnabled !== 'boolean') throw new TypeError('walletBindingEnabled must be boolean');
  for (const [name, callback] of Object.entries({ runInTransaction, assertWalletOwned, executeAdjustment })) {
    if (typeof callback !== 'function') throw new TypeError(`${name} must be a function`);
  }
  return async function adjust(rawCommand) {
    if (!walletBindingEnabled) throw unavailable();
    const command = normalize(rawCommand);
    return runInTransaction(async transaction => {
      if (!transaction || typeof transaction.query !== 'function') throw new TypeError('transaction.query is required');
      const owned = await assertWalletOwned(transaction, command);
      if (owned !== true) throw Object.assign(new Error('Wallet ownership not authorized'), { code: 'WALLET_SCOPE_DENIED' });
      return executeAdjustment(transaction, command);
    });
  };
}

export const customerWalletAdjustmentGuardContract = Object.freeze({
  productionWiringEnabled: false, walletBindingEnabledByDefault: false,
  ownershipAndExecutionShareTransaction: true, acceptsHistoricalVisibilityAsOwnership: false,
  authoritativeBindingImplemented: false, authorizesActor: false, implementsFinancialReplay: false
});
