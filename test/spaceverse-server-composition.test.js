import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mountSpaceverseServerComposition,
  spaceverseServerCompositionContract
} from '../spaceverse-server-composition.js';

test('default production runtime keeps SPACEVERSE HTTP composition disabled without dependencies', () => {
  let calls = 0;
  const result = mountSpaceverseServerComposition({
    mountActionEndpoints() {
      calls += 1;
      return { mounted: true };
    },
    mountDashboardEndpoints() {
      calls += 1;
      return { mounted: true };
    },
    createSessionScopeResolver() {
      calls += 1;
      return async () => ({});
    },
    mountSessionScopeEndpoint() {
      calls += 1;
      return { mounted: true };
    }
  });

  assert.deepEqual(result, {
    mounted: false,
    actions: null,
    dashboard: null,
    dashboardSessionScope: null
  });
  assert.equal(calls, 0);
});

test('explicit enabled runtime delegates actions, Dashboard reads and canonical session scope', () => {
  const app = { get() {}, post() {} };
  const db = { query: async () => ({ rowCount: 0, rows: [] }) };
  const resolveAuthorization = async () => ({});
  const loadMemberships = async () => [];
  const executeAdjustment = async () => ({});
  const grantAchievement = async () => ({});
  const resolveSessionScope = async () => ({ tenantId: 'tenant-1', locationId: null });
  let receivedActions;
  let receivedDashboard;
  let receivedResolver;
  let receivedSessionScopeEndpoint;
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
  const dashboardSessionScope = {
    mounted: true,
    route: '/api/spaceverse/session/dashboard-scope'
  };

  const result = mountSpaceverseServerComposition({
    app,
    runtime: { scopedModeEnabled: true },
    resolveAuthorization,
    loadMemberships,
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
    },
    createSessionScopeResolver(options) {
      receivedResolver = options;
      return resolveSessionScope;
    },
    mountSessionScopeEndpoint(options) {
      receivedSessionScopeEndpoint = options;
      return dashboardSessionScope;
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
  assert.deepEqual(receivedResolver, { loadMemberships, resolveAuthorization });
  assert.deepEqual(receivedSessionScopeEndpoint, {
    app,
    scopedModeEnabled: true,
    resolveSessionScope
  });
  assert.deepEqual(result, { mounted: true, actions, dashboard, dashboardSessionScope });
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
  const common = {
    runtime: { scopedModeEnabled: true },
    loadMemberships: async () => [],
    resolveAuthorization: async () => ({}),
    createSessionScopeResolver: () => async () => ({}),
    mountSessionScopeEndpoint: () => ({ mounted: true })
  };

  assert.throws(
    () => mountSpaceverseServerComposition({
      ...common,
      mountActionEndpoints: () => ({ mounted: false }),
      mountDashboardEndpoints: () => ({ mounted: true })
    }),
    /action endpoints failed to mount/i
  );

  assert.throws(
    () => mountSpaceverseServerComposition({
      ...common,
      mountActionEndpoints: () => ({ mounted: true }),
      mountDashboardEndpoints: () => ({ mounted: false })
    }),
    /Dashboard endpoints failed to mount/i
  );

  assert.throws(
    () => mountSpaceverseServerComposition({
      ...common,
      mountActionEndpoints: () => ({ mounted: true }),
      mountDashboardEndpoints: () => ({ mounted: true }),
      mountSessionScopeEndpoint: () => ({ mounted: false })
    }),
    /Dashboard session scope endpoint failed to mount/i
  );
});

test('server composition contract preserves fail-closed rollout boundaries', () => {
  assert.equal(spaceverseServerCompositionContract.productionEnabledByDefault, false);
  assert.equal(spaceverseServerCompositionContract.disabledModeRequiresNoRuntimeDependencies, true);
  assert.equal(spaceverseServerCompositionContract.includesCustomerMetadataActions, true);
  assert.equal(spaceverseServerCompositionContract.includesDashboardPeriodSummary, true);
  assert.equal(spaceverseServerCompositionContract.includesDashboardKpiDrilldown, true);
  assert.equal(spaceverseServerCompositionContract.includesDashboardSessionScope, true);
  assert.equal(spaceverseServerCompositionContract.dashboardScopeComesFromServerMemberships, true);
  assert.equal(spaceverseServerCompositionContract.ownsBusinessLogic, false);
  assert.equal(spaceverseServerCompositionContract.ownsPersistence, false);
  assert.equal(spaceverseServerCompositionContract.ownsAuthorizationRules, false);
  assert.equal(spaceverseServerCompositionContract.requiresMountBeforeLegacyApiBoundary, true);
  assert.equal(spaceverseServerCompositionContract.externalDependenciesAdded, false);
});
