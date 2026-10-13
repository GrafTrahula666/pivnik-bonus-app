import { mountCustomerAchievementGrantEndpoint } from './customer-achievement-grant-endpoint.js';
import { mountCustomerBonusAdjustmentEndpoint } from './customer-bonus-adjustment-endpoint.js';

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

/**
 * Compose Customer 360 write endpoints behind one deliberate rollout boundary.
 *
 * Disabled mode is dependency-free and registers nothing. Enabled mode requires
 * the canonical authorization resolver plus the existing financial/reward
 * executors, then delegates route-specific wiring to the already tested
 * endpoint modules. No mutation implementation lives here.
 *
 * This composition must be mounted before the legacy API boundary middleware.
 */
export function mountCustomer360ActionEndpoints({
  app,
  scopedModeEnabled = false,
  resolveAuthorization,
  db,
  executeAdjustment,
  grantAchievement,
  mountBonusAdjustmentEndpoint = mountCustomerBonusAdjustmentEndpoint,
  mountAchievementGrantEndpoint = mountCustomerAchievementGrantEndpoint
} = {}) {
  if (typeof scopedModeEnabled !== 'boolean') {
    throw new TypeError('scopedModeEnabled must be boolean');
  }

  if (!scopedModeEnabled) {
    return Object.freeze({
      mounted: false,
      bonusAdjustment: null,
      achievementGrant: null
    });
  }

  if (!app || typeof app.post !== 'function') throw new TypeError('app.post is required');
  requireFunction(resolveAuthorization, 'resolveAuthorization');
  requireFunction(executeAdjustment, 'executeAdjustment');
  requireFunction(grantAchievement, 'grantAchievement');
  requireFunction(mountBonusAdjustmentEndpoint, 'mountBonusAdjustmentEndpoint');
  requireFunction(mountAchievementGrantEndpoint, 'mountAchievementGrantEndpoint');

  const shared = {
    app,
    scopedModeEnabled: true,
    resolveAuthorization,
    db
  };

  const bonusAdjustment = mountBonusAdjustmentEndpoint({
    ...shared,
    executeAdjustment
  });
  if (!bonusAdjustment?.mounted) {
    throw new Error('Customer bonus adjustment endpoint failed to mount');
  }

  const achievementGrant = mountAchievementGrantEndpoint({
    ...shared,
    grantAchievement
  });
  if (!achievementGrant?.mounted) {
    throw new Error('Customer achievement grant endpoint failed to mount');
  }

  return Object.freeze({
    mounted: true,
    bonusAdjustment,
    achievementGrant
  });
}

export const customer360ActionEndpointsContract = Object.freeze({
  failClosedWhenScopedModeDisabled: true,
  sharedScopedRolloutBoundary: true,
  canonicalAuthorizationResolverRequired: true,
  sharedFinancialExecutorRequired: true,
  existingRewardExecutorRequired: true,
  revokeExposed: false,
  requiresMountBeforeLegacyApiBoundary: true,
  productionEnabledByDefault: false,
  externalDependenciesAdded: false
});
