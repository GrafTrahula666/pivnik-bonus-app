import { createCustomer360ReadRepository } from './customer-360-read-repository.js';
import { createCustomerBonusAdjustmentService } from './customer-bonus-adjustment-service.js';

function requireDb(db) {
  if (!db || typeof db.query !== 'function') throw new TypeError('db.query is required');
}

/**
 * Composition root for the Customer 360 manual bonus action.
 *
 * This deliberately binds the write orchestration to the same Customer 360
 * visibility proof used by reads. The service therefore cannot invent a second
 * tenant/location ownership rule before delegating to the shared atomic
 * adjustment executor.
 *
 * No HTTP route or production migration is enabled here.
 */
export function createCustomerBonusAdjustmentRuntime({
  db,
  executeAdjustment,
  scopedReadsEnabled = false,
  createReadRepository = createCustomer360ReadRepository
} = {}) {
  requireDb(db);
  if (typeof executeAdjustment !== 'function') {
    throw new TypeError('executeAdjustment must be a function');
  }
  if (typeof createReadRepository !== 'function') {
    throw new TypeError('createReadRepository must be a function');
  }

  const readRepository = createReadRepository({ scopedReadsEnabled });
  if (!readRepository || typeof readRepository.isCustomerVisible !== 'function') {
    throw new TypeError('Customer 360 read repository must expose isCustomerVisible');
  }

  const service = createCustomerBonusAdjustmentService({
    executeAdjustment,
    assertCustomerVisible: ({ context, tenantId, locationId, customerId }) => (
      readRepository.isCustomerVisible(db, customerId, {
        authorizationContext: context,
        tenantId,
        locationId
      })
    )
  });

  return Object.freeze({
    adjust: service.adjust,
    readRepository
  });
}

export const customerBonusAdjustmentRuntimeContract = Object.freeze({
  visibilityBoundary: 'customer-360-read-repository',
  financialBoundary: 'admin-adjustment-executor-compatible',
  scopedFallbackToGlobal: false,
  duplicatesTenantOwnershipLogic: false,
  productionRouteWired: false,
  migrationApplied: false,
  externalDependenciesAdded: false
});
