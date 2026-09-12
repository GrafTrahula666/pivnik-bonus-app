import {
  customerActionPolicyContract,
  evaluateCustomerAction
} from './customer-action-policy.js';

const ACHIEVEMENT_GRANT = customerActionPolicyContract.actions.ACHIEVEMENT_GRANT;
const ACHIEVEMENT_REVOKE = customerActionPolicyContract.actions.ACHIEVEMENT_REVOKE;

function normalizeIdentifier(value, field) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new TypeError(`${field} is required`);
  }
  return String(value).trim();
}

function requireConfirmation(value) {
  if (value !== true) {
    throw Object.assign(new Error('Explicit confirmation is required'), {
      code: 'confirmation_required'
    });
  }
}

function createCommand({ action, decision, customerId, achievementCode, requestKey }) {
  return Object.freeze({
    action,
    customerId,
    achievementCode,
    requestKey,
    actorId: decision.actorId,
    reason: decision.reason,
    tenantId: decision.tenantId,
    locationId: decision.locationId,
    audit: Object.freeze({
      action,
      actorId: decision.actorId,
      reason: decision.reason,
      tenantId: decision.tenantId,
      locationId: decision.locationId,
      requestKey,
      achievementCode
    })
  });
}

/**
 * Customer 360 orchestration boundary for manual achievement actions.
 *
 * Granting is delegated to the existing reward/achievement implementation so
 * reward_grants idempotency and wallet/journal atomicity remain the source of
 * truth. Revocation is intentionally unavailable unless an explicit audited
 * executor is supplied: deleting a grant alone would not safely claw back a
 * previously issued bonus/beer reward.
 */
export function createCustomerAchievementActionService({
  grantAchievement,
  revokeAchievement = null
} = {}) {
  if (typeof grantAchievement !== 'function') {
    throw new TypeError('grantAchievement must be a function');
  }
  if (revokeAchievement !== null && typeof revokeAchievement !== 'function') {
    throw new TypeError('revokeAchievement must be a function when provided');
  }

  async function execute({
    action,
    context,
    tenantId,
    locationId,
    actorId,
    customerId,
    achievementCode,
    reason,
    requestKey,
    confirmed = false
  } = {}) {
    const normalizedCustomerId = normalizeIdentifier(customerId, 'customerId');
    const normalizedAchievementCode = normalizeIdentifier(achievementCode, 'achievementCode');
    const normalizedRequestKey = normalizeIdentifier(requestKey, 'requestKey');

    const decision = evaluateCustomerAction({
      context,
      tenantId,
      locationId,
      action,
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

    const command = createCommand({
      action,
      decision,
      customerId: normalizedCustomerId,
      achievementCode: normalizedAchievementCode,
      requestKey: normalizedRequestKey
    });

    if (action === ACHIEVEMENT_GRANT) {
      return grantAchievement(command);
    }

    if (!revokeAchievement) {
      throw Object.assign(new Error('Achievement revocation is not safely supported'), {
        code: 'achievement_revoke_unsupported'
      });
    }

    return revokeAchievement(command);
  }

  return Object.freeze({
    grant(input = {}) {
      return execute({ ...input, action: ACHIEVEMENT_GRANT });
    },
    revoke(input = {}) {
      return execute({ ...input, action: ACHIEVEMENT_REVOKE });
    }
  });
}

export const customerAchievementActionServiceContract = Object.freeze({
  grantAction: ACHIEVEMENT_GRANT,
  revokeAction: ACHIEVEMENT_REVOKE,
  delegatesRewardLogic: true,
  requiresTenantManager: true,
  requiresActor: true,
  requiresReason: true,
  requiresConfirmation: true,
  requiresIdempotencyKey: true,
  auditMetadataIncluded: true,
  revokeDisabledWithoutAuditedExecutor: true,
  productionRouteWired: false
});
