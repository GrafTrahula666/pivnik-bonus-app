import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mountSpaceverseServerComposition,
  spaceverseServerCompositionContract
} from '../spaceverse-server-composition.js';

test('default production runtime keeps SPACEVERSE HTTP composition disabled without dependencies', () => {
  let actionCalls = 0;
  let dashboardCalls = 0;
  const result = mountSpaceverseServerComposition({
    mountActionEndpoints() {
      actionCalls += 1;
      return { mounted: true };
    },
    mountDashboardEndpoints() {
      dashboardCalls += 1;
      return { mounted: true };
    }
  });

  assert.deepEqual(result, { mounted: false, actions: null, dashboard: null });
  assert.equal(actionCalls, 0);
  assert.equal(dashboardCalls, 0);
});

test('explicit enabled runtime delegates Customer 360 and Dashboard composition with unchanged dependencies', () => {
  const app = { get() {}, post() {} };
  const db = { query: async () => ({ rowCount: 0, rows: [] }) };
  const resolveAuthorization = async () => ({});
  const executeAdjustment = async () => ({});
  const grantAchievement = async () => ({});
  let receivedActions;
  let receivedDashboard;
  const actions = {
    mounted: true,
    core: { mounted: true },
    metadata: { mounted: true }
  };
  const dashboard = {
    mounted: true,
    periodSummary: { mounted: true },
    kpiDrilldown: { mounted: true }
  };

  const result = mountSpaceverseServerComposition({
    app,
    runtime: { scopedModeEnabled: true },
    resolveAuthorization,
    db,
    executeAdjustment,
    grantAchievement,
    mountActionEndpoints(options) {
      receivedActions = options;
      return actions;
    },
    mountDashboardEndpoints(options) {
      receivedDashboard = options;
      return dashboard;
    }
  });

  assert.deepEqual(receivedActions, {
    app,
    scopedModeEnabled: true,
    resolveAuthorization,
    db,
    executeAdjustment,
    grantAchievement
  });
  assert.deepEqual(receivedDashboard, {
    app,
    scopedModeEnabled: true,
    resolveAuthorization,
    db
  });
  assert.deepEqual(result, { mounted: true, actions, dashboard });
});

test('fails closed for malformed runtime before delegating', () => {
  let calls = 0;
  const mountActionEndpoints = () => {
    calls += 1;
    return { mounted: true };
  };
  const mountDashboardEndpoints = () => {
    calls += 1;
    return { mounted: true };
  };

  assert.throws(
    () => mountSpaceverseServerComposition({ runtime: {}, mountActionEndpoints, mountDashboardEndpoints }),
    /runtime\.scopedModeEnabled must be boolean/
  );
  assert.throws(
    () => mountSpaceverseServerComposition({
      runtime: { scopedModeEnabled: 'true' },
      mountActionEndpoints,
      mountDashboardEndpoints
    }),
    /runtime\.scopedModeEnabled must be boolean/
  );
  assert.equal(calls, 0);
});

test('enabled composition refuses delegated non-mount results', () => {
  assert.throws(
    () => mountSpaceverseServerComposition({
      runtime: { scopedModeEnabled: true },
      mountActionEndpoints: () => ({ mounted: false }),
      mountDashboardEndpoints: () => ({ mounted: true })
    }),
    /action endpoints failed to mount/i
  );

  assert.throws(
    () => mountSpaceverseServerComposition({
      runtime: { scopedModeEnabled: true },
      mountActionEndpoints: () => ({ mounted: true }),
      mountDashboardEndpoints: () => ({ mounted: false })
    }),
    /Dashboard endpoints failed to mount/i
  );
});

test('server composition contract preserves fail-closed rollout boundaries', () => {
  assert.equal(spaceverseServerCompositionContract.productionEnabledByDefault, false);
  assert.equal(spaceverseServerCompositionContract.disabledModeRequiresNoRuntimeDependencies, true);
  assert.equal(spaceverseServerCompositionContract.includesCustomerMetadataActions, true);
  assert.equal(spaceverseServerCompositionContract.includesDashboardPeriodSummary, true);
  assert.equal(spaceverseServerCompositionContract.includesDashboardKpiDrilldown, true);
  assert.equal(spaceverseServerCompositionContract.ownsBusinessLogic, false);
  assert.equal(spaceverseServerCompositionContract.ownsPersistence, false);
  assert.equal(spaceverseServerCompositionContract.ownsAuthorizationRules, false);
  assert.equal(spaceverseServerCompositionContract.requiresMountBeforeLegacyApiBoundary, true);
  assert.equal(spaceverseServerCompositionContract.externalDependenciesAdded, false);
});
