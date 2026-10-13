import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DASHBOARD_KPI_DRILLDOWN_ROUTE,
  mountDashboardKpiDrilldownEndpoint
} from '../dashboard-kpi-drilldown-endpoint.js';

test('does not register the route while scoped mode is disabled', () => {
  let registrations = 0;
  const result = mountDashboardKpiDrilldownEndpoint({
    app: { get() { registrations += 1; } },
    scopedModeEnabled: false
  });

  assert.equal(registrations, 0);
  assert.deepEqual(result, { mounted: false, route: DASHBOARD_KPI_DRILLDOWN_ROUTE });
});

test('mounts adminRead tenant-scoped middleware and drilldown handler when enabled', () => {
  const registrations = [];
  let middlewareOptions;
  let runtimeOptions;
  let handlerOptions;
  const middleware = () => {};
  const handler = () => {};
  const runtime = { async getKpiDrilldown() { return {}; } };

  const result = mountDashboardKpiDrilldownEndpoint({
    app: { get(...args) { registrations.push(args); } },
    scopedModeEnabled: true,
    resolveAuthorization: async () => ({}),
    db: { query() {} },
    createAuthorizationMiddleware(options) { middlewareOptions = options; return middleware; },
    createRuntime(options) { runtimeOptions = options; return runtime; },
    createRouteHandler(options) { handlerOptions = options; return handler; }
  });

  assert.equal(middlewareOptions.legacyCapability, 'adminRead');
  assert.equal(middlewareOptions.scopeMode, 'tenant');
  assert.equal(runtimeOptions.scopedReadsEnabled, true);
  assert.equal(runtimeOptions.db.query instanceof Function, true);
  assert.equal(typeof handlerOptions.getKpiDrilldown, 'function');
  assert.deepEqual(registrations, [[DASHBOARD_KPI_DRILLDOWN_ROUTE, middleware, handler]]);
  assert.equal(result.mounted, true);
  assert.equal(result.runtime, runtime);
});

test('validates enabled endpoint dependencies fail closed', () => {
  assert.throws(
    () => mountDashboardKpiDrilldownEndpoint({ scopedModeEnabled: true }),
    /app\.get is required/
  );
  assert.throws(
    () => mountDashboardKpiDrilldownEndpoint({
      app: { get() {} }, scopedModeEnabled: true, resolveAuthorization: async () => {},
      createRuntime: () => ({}), createRouteHandler: () => () => {}
    }),
    /Dashboard drilldown runtime must expose getKpiDrilldown/
  );
});
