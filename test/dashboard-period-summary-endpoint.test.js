import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DASHBOARD_PERIOD_SUMMARY_ROUTE,
  mountDashboardPeriodSummaryEndpoint
} from '../dashboard-period-summary-endpoint.js';

test('does not register Dashboard route while scoped mode is disabled', () => {
  let getCalls = 0;
  const app = { get() { getCalls += 1; } };

  const result = mountDashboardPeriodSummaryEndpoint({ app, scopedModeEnabled: false });

  assert.deepEqual(result, { mounted: false, route: DASHBOARD_PERIOD_SUMMARY_ROUTE });
  assert.equal(getCalls, 0);
});

test('mounts one tenant-manager read endpoint when explicitly enabled', () => {
  const calls = [];
  const authorizationMiddleware = () => {};
  const handler = () => {};
  const runtime = { getPeriodSummary: async () => ({}) };
  const resolveAuthorization = async () => ({});
  const db = { query: async () => ({ rows: [] }) };
  let authorizationOptions;
  let runtimeOptions;
  let handlerOptions;

  const result = mountDashboardPeriodSummaryEndpoint({
    app: { get(...args) { calls.push(args); } },
    scopedModeEnabled: true,
    resolveAuthorization,
    db,
    createAuthorizationMiddleware(options) {
      authorizationOptions = options;
      return authorizationMiddleware;
    },
    createRuntime(options) {
      runtimeOptions = options;
      return runtime;
    },
    createRouteHandler(options) {
      handlerOptions = options;
      return handler;
    }
  });

  assert.equal(result.mounted, true);
  assert.equal(result.route, DASHBOARD_PERIOD_SUMMARY_ROUTE);
  assert.equal(result.runtime, runtime);
  assert.deepEqual(calls, [[DASHBOARD_PERIOD_SUMMARY_ROUTE, authorizationMiddleware, handler]]);
  assert.deepEqual(authorizationOptions, {
    resolveAuthorization,
    legacyCapability: 'adminRead',
    scopeMode: 'tenant'
  });
  assert.deepEqual(runtimeOptions, { db, scopedReadsEnabled: true });
  assert.equal(typeof handlerOptions.getPeriodSummary, 'function');
});

test('validates enabled wiring before route registration', () => {
  const app = { get() { assert.fail('route must not be registered'); } };

  assert.throws(
    () => mountDashboardPeriodSummaryEndpoint({ app, scopedModeEnabled: true }),
    /resolveAuthorization must be a function/
  );

  assert.throws(
    () => mountDashboardPeriodSummaryEndpoint({
      app,
      scopedModeEnabled: true,
      resolveAuthorization: async () => ({}),
      createAuthorizationMiddleware: () => () => {},
      createRuntime: () => ({})
    }),
    /runtime must expose getPeriodSummary/i
  );
});
