import { createCustomer360ReadRepository } from './customer-360-read-repository.js';
import { createCustomerAchievementActionService } from './customer-achievement-action-service.js';

function requireDb(db) {
  if (!db || typeof db.query !== 'function') throw new TypeError('db.query is required');
}

/**
 * Composition root for Customer 360 achievement actions.
 *
 * Achievement writes reuse the same canonical visibility proof as Customer 360
 * reads. No global customer-id fallback is allowed. The concrete grant executor
 * is injected so this layer cannot duplicate reward-engine behavior.
 */
export function createCustomerAchievementActionRuntime({
  db,
  grantAchievement,
  revokeAchievement = null,
  scopedReadsEnabled = false,
  createReadRepository = createCustomer360ReadRepository
} = {}) {
  requireDb(db);
  if (typeof grantAchievement !== 'function') {
    throw new TypeError('grantAchievement must be a function');
  }
  if (typeof createReadRepository !== 'function') {
    throw new TypeError('createReadRepository must be a function');
  }

  const readRepository = createReadRepository({ scopedReadsEnabled });
  if (!readRepository || typeof readRepository.isCustomerVisible !== 'function') {
    throw new TypeError('Customer 360 read repository must expose isCustomerVisible');
  }

  const service = createCustomerAchievementActionService({
    grantAchievement,
    revokeAchievement,
    assertCustomerVisible: ({ context, tenantId, locationId, customerId }) => (
      readRepository.isCustomerVisible(db, customerId, {
        authorizationContext: context,
        tenantId,
        locationId
      })
    )
  });

  return Object.freeze({
    grant: service.grant,
    revoke: service.revoke,
    readRepository
  });
}

export const customerAchievementActionRuntimeContract = Object.freeze({
  visibilityBoundary: 'customer-360-read-repository',
  rewardBoundary: 'existing-achievement-reward-executor',
  scopedFallbackToGlobal: false,
  duplicatesTenantOwnershipLogic: false,
  revokeFailClosedWithoutExecutor: true,
  productionRouteWired: false,
  migrationApplied: false,
  externalDependenciesAdded: false
});
