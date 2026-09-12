import {
  customerActionPolicyContract,
  evaluateCustomerAction
} from './customer-action-policy.js';

const BONUS_ADJUST = customerActionPolicyContract.actions.BONUS_ADJUST;

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

function requireConfirmation(value) {
  if (value !== true) {
    throw Object.assign(new Error('Explicit confirmation is required'), {
      code: 'confirmation_required'
    });
  }
}

/**
 * Customer 360 orchestration boundary for manual bonus adjustments.
 *
 * This service intentionally does not duplicate wallet arithmetic, row locking,
 * request-key replay handling or transaction persistence. After authorization it
 * delegates to the existing admin adjustment executor so the legacy financial
 * invariants remain the single source of truth until the scoped write path is
 * deliberately enabled.
 */
export function createCustomerBonusAdjustmentService({ executeAdjustment } = {}) {
  if (typeof executeAdjustment !== 'function') {
    throw new TypeError('executeAdjustment must be a function');
  }

  return Object.freeze({
    async adjust({
      context,
      tenantId,
      locationId,
      actorId,
      customerId,
      amount,
      reason,
      requestKey,
      confirmed = false
    } = {}) {
      const normalizedCustomerId = normalizeIdentifier(customerId, 'customerId');
      const normalizedRequestKey = normalizeIdentifier(requestKey, 'requestKey');
      const normalizedAmount = normalizeAmount(amount);

      const decision = evaluateCustomerAction({
        context,
        tenantId,
        locationId,
        action: BONUS_ADJUST,
        actorId,
        reason
      });

      if (!decision.allowed) {
        throw Object.assign(new Error(`Customer action denied: ${decision.code}`), {
          code: decision.code,
          decision
        });
      }

      requireConfirmation(confirmed);

      const command = Object.freeze({
        customerId: normalizedCustomerId,
        amount: normalizedAmount,
        reason: decision.reason,
        requestKey: normalizedRequestKey,
        actorId: decision.actorId,
        tenantId: decision.tenantId,
        locationId: decision.locationId,
        audit: Object.freeze({
          action: BONUS_ADJUST,
          actorId: decision.actorId,
          reason: decision.reason,
          tenantId: decision.tenantId,
          locationId: decision.locationId,
          requestKey: normalizedRequestKey
        })
      });

      return executeAdjustment(command);
    }
  });
}

export const customerBonusAdjustmentServiceContract = Object.freeze({
  action: BONUS_ADJUST,
  delegatesFinancialLogic: true,
  duplicatesWalletArithmetic: false,
  requiresTenantManager: true,
  requiresActor: true,
  requiresReason: true,
  requiresConfirmation: true,
  requiresIdempotencyKey: true,
  auditMetadataIncluded: true,
  productionRouteWired: false
});
