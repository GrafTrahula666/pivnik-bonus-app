import { createScopedAuthorizationMiddleware } from './authorization-middleware.js';
import { createDashboardKpiDrilldownRuntime } from './dashboard-kpi-drilldown-runtime.js';
import { createDashboardKpiDrilldownRouteHandler } from './dashboard-kpi-drilldown-route-handler.js';

export const DASHBOARD_KPI_DRILLDOWN_ROUTE =
  '/api/spaceverse/tenants/:tenantId/dashboard/drilldown/:metric';

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

export function mountDashboardKpiDrilldownEndpoint({
  app,
  scopedModeEnabled = false,
  resolveAuthorization,
  db,
  createRuntime = createDashboardKpiDrilldownRuntime,
  createRouteHandler = createDashboardKpiDrilldownRouteHandler,
  createAuthorizationMiddleware = createScopedAuthorizationMiddleware
} = {}) {
  if (typeof scopedModeEnabled !== 'boolean') throw new TypeError('scopedModeEnabled must be boolean');

  if (!scopedModeEnabled) {
    return Object.freeze({ mounted: false, route: DASHBOARD_KPI_DRILLDOWN_ROUTE });
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
  if (!runtime || typeof runtime.getKpiDrilldown !== 'function') {
    throw new TypeError('Dashboard drilldown runtime must expose getKpiDrilldown');
  }

  const handler = createRouteHandler({ getKpiDrilldown: runtime.getKpiDrilldown.bind(runtime) });
  requireFunction(handler, 'dashboardKpiDrilldownRouteHandler');

  app.get(DASHBOARD_KPI_DRILLDOWN_ROUTE, authorizationMiddleware, handler);

  return Object.freeze({ mounted: true, route: DASHBOARD_KPI_DRILLDOWN_ROUTE, runtime });
}

export const dashboardKpiDrilldownEndpointContract = Object.freeze({
  failClosedWhenScopedModeDisabled: true,
  scopeMode: 'tenant',
  legacyCapability: 'adminRead',
  staffTenantWideAccess: false,
  optionalLocationFilter: true,
  readOnly: true,
  productionEnabledByDefault: false,
  externalDependenciesAdded: false
});
