import { createAdminAdjustmentExecutor } from './admin-adjustment-executor.js';
import { createAdminAdjustmentRouteHandler } from './admin-adjustment-route-handler.js';

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

/**
 * Compose the legacy admin adjustment HTTP handler over the shared atomic
 * adjustment executor.
 *
 * Keeping this composition outside server.js makes the eventual production
 * wiring intentionally small: server.js only supplies its existing pool,
 * request-key lock, semantic replay validator, unlimited-bonus predicate and
 * request-key normalizer. The financial implementation remains owned by the
 * shared executor and the historical HTTP response remains owned by the route
 * handler.
 */
export function createAdminAdjustmentRuntime({
  pool,
  lockRequestKey,
  assertMatchingTransaction,
  hasUnlimitedBonus,
  normalizeRequestKey,
  createExecutor = createAdminAdjustmentExecutor,
  createRouteHandler = createAdminAdjustmentRouteHandler
} = {}) {
  requireFunction(createExecutor, 'createExecutor');
  requireFunction(createRouteHandler, 'createRouteHandler');
  requireFunction(normalizeRequestKey, 'normalizeRequestKey');

  const executeAdjustment = createExecutor({
    pool,
    lockRequestKey,
    assertMatchingTransaction,
    hasUnlimitedBonus
  });
  requireFunction(executeAdjustment, 'executeAdjustment');

  const handler = createRouteHandler({
    normalizeRequestKey,
    executeAdjustment
  });
  requireFunction(handler, 'adminAdjustmentRouteHandler');

  return Object.freeze({
    executeAdjustment,
    handler
  });
}

export const adminAdjustmentRuntimeContract = Object.freeze({
  route: '/api/admin/users/:id/adjust',
  sharedAtomicExecutor: true,
  preservesLegacyHttpAdapter: true,
  ownsAuthorization: false,
  ownsRouteRegistration: false,
  productionRouteWired: false,
  externalDependenciesAdded: false
});
