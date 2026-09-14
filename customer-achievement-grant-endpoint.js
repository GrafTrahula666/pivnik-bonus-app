import { createScopedAuthorizationMiddleware } from './authorization-middleware.js';
import { createCustomerAchievementActionRuntime } from './customer-achievement-action-runtime.js';
import { createCustomerAchievementGrantRouteHandler } from './customer-achievement-grant-route-handler.js';

export const CUSTOMER_ACHIEVEMENT_GRANT_ROUTE =
  '/api/spaceverse/tenants/:tenantId/locations/:locationId/customers/:id/achievements/:achievementCode/grants';

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

/**
 * Compose and mount the Customer 360 manual achievement grant endpoint.
 *
 * Rollout is fail-closed: no route is registered while scoped mode is disabled.
 * When explicitly enabled, requests pass through location-scoped authorization,
 * canonical Customer 360 visibility proof and the caller-supplied existing
 * reward executor. Revocation is intentionally not exposed by this endpoint.
 */
export function mountCustomerAchievementGrantEndpoint({
  app,
  scopedModeEnabled = false,
  resolveAuthorization,
  db,
  grantAchievement,
  createRuntime = createCustomerAchievementActionRuntime,
  createRouteHandler = createCustomerAchievementGrantRouteHandler,
  createAuthorizationMiddleware = createScopedAuthorizationMiddleware
} = {}) {
  if (typeof scopedModeEnabled !== 'boolean') {
    throw new TypeError('scopedModeEnabled must be boolean');
  }

  if (!scopedModeEnabled) {
    return Object.freeze({ mounted: false, route: CUSTOMER_ACHIEVEMENT_GRANT_ROUTE });
  }

  if (!app || typeof app.post !== 'function') throw new TypeError('app.post is required');
  requireFunction(resolveAuthorization, 'resolveAuthorization');
  requireFunction(grantAchievement, 'grantAchievement');
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
    grantAchievement,
    scopedReadsEnabled: true
  });
  if (!runtime || typeof runtime.grant !== 'function') {
    throw new TypeError('Customer achievement runtime must expose grant');
  }

  const handler = createRouteHandler({ grant: runtime.grant });
  requireFunction(handler, 'customerAchievementGrantRouteHandler');

  app.post(CUSTOMER_ACHIEVEMENT_GRANT_ROUTE, authorizationMiddleware, handler);

  return Object.freeze({
    mounted: true,
    route: CUSTOMER_ACHIEVEMENT_GRANT_ROUTE,
    runtime
  });
}

export const customerAchievementGrantEndpointContract = Object.freeze({
  failClosedWhenScopedModeDisabled: true,
  scopeMode: 'location',
  legacyCapability: 'adminWrite',
  canonicalCustomerVisibilityProof: true,
  existingRewardExecutorRequired: true,
  revokeExposed: false,
  productionEnabledByDefault: false,
  externalDependenciesAdded: false
});
