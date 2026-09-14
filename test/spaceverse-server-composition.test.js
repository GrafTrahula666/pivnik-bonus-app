import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mountSpaceverseServerComposition,
  spaceverseServerCompositionContract
} from '../spaceverse-server-composition.js';

test('default production runtime keeps SPACEVERSE HTTP composition disabled without dependencies', () => {
  let calls = 0;
  const result = mountSpaceverseServerComposition({
    mountActionEndpoints() { calls += 1; return { mounted: true }; },
    mountDashboardEndpoints() { calls += 1; return { mounted: true }; },
    createSessionScopeResolver() { calls += 1; return async () => ({}); },
    mountSessionScopeEndpoint() { calls += 1; return { mounted: true }; },
    createScopeSelectionResolver() { calls += 1; return async () => ({}); },
    createScopeDirectory() { calls += 1; return {}; },
    mountScopeSelectionEndpoint() { calls += 1; return { mounted: true }; }
  });

  assert.deepEqual(result, {
    mounted: false,
    actions: null,
    dashboard: null,
    dashboardSessionScope: null,
    dashboardScopeSelection: null
  });
  assert.equal(calls, 0);
});

test('explicit enabled runtime delegates actions, Dashboard reads, directory, session scope and validated selection', () => {
  const app = { get() {}, post() {} };
  const db = { query: async () => ({ rowCount: 0, rows: [] }) };
  const resolveAuthorization = async () => ({});
  const loadMemberships = async () => [];
  const executeAdjustment = async () => ({});
  const grantAchievement = async () => ({});
  const resolveSessionScope = async () => ({ tenantId: 'tenant-1', locationId: null });
  const selectDashboardScope = async () => ({ tenantId: 'tenant-2', locationId: null });
  const scopeDirectory = { findTenant: async () => ({}), findLocation: async () => ({}) };
  let receivedActions;
  let receivedDashboard;
  let receivedResolver;
  let receivedSessionScopeEndpoint;
  let receivedDirectoryOptions;
  let receivedSelectionResolver;
  let receivedSelectionEndpoint;
  const actions = { mounted: true, core: { mounted: true }, metadata: { mounted: true } };
  const dashboard = { mounted: true, periodSummary: { mounted: true }, kpiDrilldown: { mounted: true } };
  const dashboardSessionScope = { mounted: true, route: '/api/spaceverse/session/dashboard-scope' };
  const dashboardScopeSelection = { mounted: true, route: '/api/spaceverse/session/dashboard-scope/select' };

  const result = mountSpaceverseServerComposition({
    app,
    runtime: { scopedModeEnabled: true },
    resolveAuthorization,
    loadMemberships,
    db,
    executeAdjustment,
    grantAchievement,
    mountActionEndpoints(options) { receivedActions = options; return actions; },
    mountDashboardEndpoints(options) { receivedDashboard = options; return dashboard; },
    createSessionScopeResolver(options) { receivedResolver = options; return resolveSessionScope; },
    mountSessionScopeEndpoint(options) { receivedSessionScopeEndpoint = options; return dashboardSessionScope; },
    createScopeDirectory(options) { receivedDirectoryOptions = options; return scopeDirectory; },
    createScopeSelectionResolver(options) { receivedSelectionResolver = options; return selectDashboardScope; },
    mountScopeSelectionEndpoint(options) { receivedSelectionEndpoint = options; return dashboardScopeSelection; }
  });

  assert.deepEqual(receivedActions, { app, scopedModeEnabled: true, resolveAuthorization, db, executeAdjustment, grantAchievement });
  assert.deepEqual(receivedDashboard, { app, scopedModeEnabled: true, resolveAuthorization, db });
  assert.deepEqual(receivedResolver, { loadMemberships, resolveAuthorization });
  assert.deepEqual(receivedSessionScopeEndpoint, { app, scopedModeEnabled: true, resolveSessionScope });
  assert.equal(typeof receivedDirectoryOptions.query, 'function');
  assert.deepEqual(receivedSelectionResolver, { loadMemberships, resolveAuthorization, scopeDirectory });
  assert.deepEqual(receivedSelectionEndpoint, { app, scopedModeEnabled: true, selectDashboardScope });
  assert.deepEqual(result, { mounted: true, actions, dashboard, dashboardSessionScope, dashboardScopeSelection });
});

test('fails closed for malformed runtime before delegating', () => {
  let calls = 0;
  const mountActionEndpoints = () => { calls += 1; return { mounted: true }; };
  const mountDashboardEndpoints = () => { calls += 1; return { mounted: true }; };
  assert.throws(() => mountSpaceverseServerComposition({ runtime: {}, mountActionEndpoints, mountDashboardEndpoints }), /runtime\.scopedModeEnabled must be boolean/);
  assert.throws(() => mountSpaceverseServerComposition({ runtime: { scopedModeEnabled: 'true' }, mountActionEndpoints, mountDashboardEndpoints }), /runtime\.scopedModeEnabled must be boolean/);
  assert.equal(calls, 0);
});

test('enabled composition refuses delegated non-mount results', () => {
  const common = {
    runtime: { scopedModeEnabled: true },
    db: { query: async () => ({ rows: [] }) },
    loadMemberships: async () => [],
    resolveAuthorization: async () => ({}),
    createSessionScopeResolver: () => async () => ({}),
    mountSessionScopeEndpoint: () => ({ mounted: true }),
    createScopeDirectory: () => ({ findTenant: async () => null, findLocation: async () => null }),
    createScopeSelectionResolver: () => async () => ({}),
    mountScopeSelectionEndpoint: () => ({ mounted: true })
  };

  assert.throws(() => mountSpaceverseServerComposition({ ...common, mountActionEndpoints: () => ({ mounted: false }), mountDashboardEndpoints: () => ({ mounted: true }) }), /action endpoints failed to mount/i);
  assert.throws(() => mountSpaceverseServerComposition({ ...common, mountActionEndpoints: () => ({ mounted: true }), mountDashboardEndpoints: () => ({ mounted: false }) }), /Dashboard endpoints failed to mount/i);
  assert.throws(() => mountSpaceverseServerComposition({ ...common, mountActionEndpoints: () => ({ mounted: true }), mountDashboardEndpoints: () => ({ mounted: true }), mountSessionScopeEndpoint: () => ({ mounted: false }) }), /Dashboard session scope endpoint failed to mount/i);
  assert.throws(() => mountSpaceverseServerComposition({ ...common, mountActionEndpoints: () => ({ mounted: true }), mountDashboardEndpoints: () => ({ mounted: true }), mountScopeSelectionEndpoint: () => ({ mounted: false }) }), /Dashboard scope selection endpoint failed to mount/i);
});

test('server composition contract preserves fail-closed rollout boundaries', () => {
  assert.equal(spaceverseServerCompositionContract.productionEnabledByDefault, false);
  assert.equal(spaceverseServerCompositionContract.disabledModeRequiresNoRuntimeDependencies, true);
  assert.equal(spaceverseServerCompositionContract.includesCustomerMetadataActions, true);
  assert.equal(spaceverseServerCompositionContract.includesDashboardPeriodSummary, true);
  assert.equal(spaceverseServerCompositionContract.includesDashboardKpiDrilldown, true);
  assert.equal(spaceverseServerCompositionContract.includesDashboardSessionScope, true);
  assert.equal(spaceverseServerCompositionContract.includesDashboardValidatedTenantSelection, true);
  assert.equal(spaceverseServerCompositionContract.dashboardScopeComesFromServerMemberships, true);
  assert.equal(spaceverseServerCompositionContract.dashboardBrowserTenantSelectionGrantsNoAuthority, true);
  assert.equal(spaceverseServerCompositionContract.scopeSelectionUsesAuthoritativeDirectory, true);
  assert.equal(spaceverseServerCompositionContract.platformAdminSelectionRequiresAuthoritativeDirectory, true);
  assert.equal(spaceverseServerCompositionContract.locationSelectionRequiresAuthoritativeDirectory, true);
  assert.equal(spaceverseServerCompositionContract.ownsBusinessLogic, false);
  assert.equal(spaceverseServerCompositionContract.ownsPersistence, false);
  assert.equal(spaceverseServerCompositionContract.ownsAuthorizationRules, false);
  assert.equal(spaceverseServerCompositionContract.requiresMountBeforeLegacyApiBoundary, true);
  assert.equal(spaceverseServerCompositionContract.externalDependenciesAdded, false);
});
