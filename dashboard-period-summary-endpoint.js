import { createScopedAuthorizationMiddleware } from './authorization-middleware.js';
import { createDashboardPeriodSummaryRuntime } from './dashboard-period-summary-runtime.js';
import { createDashboardPeriodSummaryRouteHandler } from './dashboard-period-summary-route-handler.js';

export const DASHBOARD_PERIOD_SUMMARY_ROUTE =
  '/api/spaceverse/tenants/:tenantId/dashboard/period-summary';

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

/**
 * Compose and mount the read-only owner Dashboard period summary endpoint.
 *
 * This endpoint is tenant-manager scoped: staff membership alone cannot access
 * tenant-wide Dashboard data. A caller may optionally narrow the query to one
 * locationId, but can never widen beyond the authorized tenant. Rollout remains
 * fail-closed while scoped mode is disabled.
 */
export function mountDashboardPeriodSummaryEndpoint({
  app,
  scopedModeEnabled = false,
  resolveAuthorization,
  db,
  createRuntime = createDashboardPeriodSummaryRuntime,
  createRouteHandler = createDashboardPeriodSummaryRouteHandler,
  createAuthorizationMiddleware = createScopedAuthorizationMiddleware
} = {}) {
  if (typeof scopedModeEnabled !== 'boolean') throw new TypeError('scopedModeEnabled must be boolean');

  if (!scopedModeEnabled) {
    return Object.freeze({ mounted: false, route: DASHBOARD_PERIOD_SUMMARY_ROUTE });
  }

  if (!app || typeof app.get !== 'function') throw new TypeError('app.get is required');
  requireFunction(resolveAuthorization, 'resolveAuthorization');
  requireFunction(createRuntime, 'createRuntime');
  requireFunction(createRouteHandler, 'createRouteHandler');
  requireFunction(createAuthorizationMiddleware, 'createAuthorizationMiddleware');

  const authorizationMiddleware = createAuthorizationMiddleware({
    resolveAuthorization,
    legacyCapability: 'adminRead',
    scopeMode: 'tenant'
  });

  const runtime = createRuntime({ db, scopedReadsEnabled: true });
  if (!runtime || typeof runtime.getPeriodSummary !== 'function') {
    throw new TypeError('Dashboard runtime must expose getPeriodSummary');
  }

  const handler = createRouteHandler({ getPeriodSummary: runtime.getPeriodSummary.bind(runtime) });
  requireFunction(handler, 'dashboardPeriodSummaryRouteHandler');

  app.get(DASHBOARD_PERIOD_SUMMARY_ROUTE, authorizationMiddleware, handler);

  return Object.freeze({
    mounted: true,
    route: DASHBOARD_PERIOD_SUMMARY_ROUTE,
    runtime
  });
}

export const dashboardPeriodSummaryEndpointContract = Object.freeze({
  failClosedWhenScopedModeDisabled: true,
  scopeMode: 'tenant',
  legacyCapability: 'adminRead',
  staffTenantWideAccess: false,
  optionalLocationFilter: true,
  readOnly: true,
  productionEnabledByDefault: false,
  externalDependenciesAdded: false
});
