import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mountDashboardReadEndpoints,
  dashboardReadEndpointsContract
} from '../dashboard-read-endpoints.js';

test('disabled Dashboard composition is dependency-free and mounts nothing', () => {
  let periodCalls = 0;
  let drilldownCalls = 0;

  const result = mountDashboardReadEndpoints({
    mountPeriodSummary() {
      periodCalls += 1;
      return { mounted: true };
    },
    mountKpiDrilldown() {
      drilldownCalls += 1;
      return { mounted: true };
    }
  });

  assert.deepEqual(result, {
    mounted: false,
    periodSummary: null,
    kpiDrilldown: null
  });
  assert.equal(periodCalls, 0);
  assert.equal(drilldownCalls, 0);
});

test('enabled Dashboard composition delegates identical scoped dependencies to both endpoints', () => {
  const app = { get() {} };
  const db = { query: async () => ({ rowCount: 0, rows: [] }) };
  const resolveAuthorization = async () => ({});
  const received = [];
  const periodSummary = { mounted: true, route: '/period-summary' };
  const kpiDrilldown = { mounted: true, route: '/drilldown/:metric' };

  const result = mountDashboardReadEndpoints({
    app,
    scopedModeEnabled: true,
    resolveAuthorization,
    db,
    mountPeriodSummary(options) {
      received.push(['period', options]);
      return periodSummary;
    },
    mountKpiDrilldown(options) {
      received.push(['drilldown', options]);
      return kpiDrilldown;
    }
  });

  const expected = {
    app,
    scopedModeEnabled: true,
    resolveAuthorization,
    db
  };

  assert.deepEqual(received, [
    ['period', expected],
    ['drilldown', expected]
  ]);
  assert.deepEqual(result, {
    mounted: true,
    periodSummary,
    kpiDrilldown
  });
});

test('Dashboard composition fails closed for malformed rollout state', () => {
  assert.throws(
    () => mountDashboardReadEndpoints({ scopedModeEnabled: 'true' }),
    /scopedModeEnabled must be boolean/
  );
});

test('Dashboard composition refuses partial mount results', () => {
  assert.throws(
    () => mountDashboardReadEndpoints({
      scopedModeEnabled: true,
      mountPeriodSummary: () => ({ mounted: false }),
      mountKpiDrilldown: () => ({ mounted: true })
    }),
    /period summary endpoint failed to mount/i
  );

  assert.throws(
    () => mountDashboardReadEndpoints({
      scopedModeEnabled: true,
      mountPeriodSummary: () => ({ mounted: true }),
      mountKpiDrilldown: () => ({ mounted: false })
    }),
    /KPI drilldown endpoint failed to mount/i
  );
});

test('Dashboard composition contract preserves owner read boundaries', () => {
  assert.equal(dashboardReadEndpointsContract.failClosedWhenScopedModeDisabled, true);
  assert.equal(dashboardReadEndpointsContract.disabledModeRequiresNoRuntimeDependencies, true);
  assert.equal(dashboardReadEndpointsContract.scopeMode, 'tenant');
  assert.equal(dashboardReadEndpointsContract.legacyCapability, 'adminRead');
  assert.equal(dashboardReadEndpointsContract.staffTenantWideAccess, false);
  assert.equal(dashboardReadEndpointsContract.optionalLocationFilter, true);
  assert.equal(dashboardReadEndpointsContract.readOnly, true);
  assert.equal(dashboardReadEndpointsContract.productionEnabledByDefault, false);
  assert.equal(dashboardReadEndpointsContract.externalDependenciesAdded, false);
});
