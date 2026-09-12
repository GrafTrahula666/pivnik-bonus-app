import { createScopedAuthorizationMiddleware } from './authorization-middleware.js';
import { createCustomerBonusAdjustmentRuntime } from './customer-bonus-adjustment-runtime.js';
import { createCustomerBonusAdjustmentRouteHandler } from './customer-bonus-adjustment-route-handler.js';

export const CUSTOMER_BONUS_ADJUSTMENT_ROUTE =
  '/api/spaceverse/tenants/:tenantId/locations/:locationId/customers/:id/bonus-adjustments';

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

/**
 * Compose and mount the Customer 360 manual bonus endpoint.
 *
 * Rollout is deliberately fail-closed: while scoped mode is disabled this
 * function does not register any route at all. Enabling the endpoint therefore
 * remains an explicit release decision after tenant attribution/migrations are
 * approved. When enabled, the HTTP path is forced through the existing scoped
 * authorization middleware, canonical Customer 360 visibility proof and the
 * shared atomic adjustment executor supplied by the caller.
 *
 * This helper must be invoked before the legacy API boundary is mounted.
 */
export function mountCustomerBonusAdjustmentEndpoint({
  app,
  scopedModeEnabled = false,
  resolveAuthorization,
  db,
  executeAdjustment,
  createRuntime = createCustomerBonusAdjustmentRuntime,
  createRouteHandler = createCustomerBonusAdjustmentRouteHandler,
  createAuthorizationMiddleware = createScopedAuthorizationMiddleware
} = {}) {
  if (typeof scopedModeEnabled !== 'boolean') {
    throw new TypeError('scopedModeEnabled must be boolean');
  }

  if (!scopedModeEnabled) {
    return Object.freeze({ mounted: false, route: CUSTOMER_BONUS_ADJUSTMENT_ROUTE });
  }

  if (!app || typeof app.post !== 'function') throw new TypeError('app.post is required');
  requireFunction(resolveAuthorization, 'resolveAuthorization');
  requireFunction(executeAdjustment, 'executeAdjustment');
  requireFunction(createRuntime, 'createRuntime');
  requireFunction(createRouteHandler, 'createRouteHandler');
  requireFunction(createAuthorizationMiddleware, 'createAuthorizationMiddleware');

  const authorizationMiddleware = createAuthorizationMiddleware({
    resolveAuthorization,
    legacyCapability: 'adminWrite',
    scopeMode: 'location'
  });

  const runtime = createRuntime({
    db,
    executeAdjustment,
    scopedReadsEnabled: true
  });
  if (!runtime || typeof runtime.adjust !== 'function') {
    throw new TypeError('Customer bonus runtime must expose adjust');
  }

  const handler = createRouteHandler({ adjust: runtime.adjust });
  requireFunction(handler, 'customerBonusAdjustmentRouteHandler');

  app.post(CUSTOMER_BONUS_ADJUSTMENT_ROUTE, authorizationMiddleware, handler);

  return Object.freeze({
    mounted: true,
    route: CUSTOMER_BONUS_ADJUSTMENT_ROUTE,
    runtime
  });
}

export const customerBonusAdjustmentEndpointContract = Object.freeze({
  failClosedWhenScopedModeDisabled: true,
  scopeMode: 'location',
  legacyCapability: 'adminWrite',
  canonicalCustomerVisibilityProof: true,
  sharedFinancialExecutorRequired: true,
  requiresMountBeforeLegacyApiBoundary: true,
  productionEnabledByDefault: false,
  externalDependenciesAdded: false
});
