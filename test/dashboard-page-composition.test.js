import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardPageComposition, dashboardPageCompositionContract } from '../dashboard-page-composition.js';

class FakeRoot {
  constructor() { this.children = []; }
  replaceChildren(...nodes) { this.children = [...nodes]; }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function harness(overrides = {}) {
  const adapters = [];
  const controllers = [];
  const root = new FakeRoot();
  const networkAdapterFactory = (options) => {
    adapters.push(options);
    return {
      loadSummary: async () => ({ period: {}, comparisonPeriod: {}, metrics: {} }),
      loadDrilldown: async () => ({ ok: true, drilldown: { rows: [], limit: 50, offset: 0, hasMore: false } })
    };
  };
  const uiControllerFactory = (options) => {
    const instance = {
      options,
      mounted: false,
      mount() { this.mounted = true; return true; },
      unmount() { this.mounted = false; return true; }
    };
    controllers.push(instance);
    return instance;
  };
  const composition = createDashboardPageComposition({
    root,
    documentRef: {},
    resolveSessionScope: async () => ({ tenantId: 'tenant-session', locationId: 'location-session' }),
    fetchImpl: async () => { throw new Error('network not expected'); },
    clock: () => Date.parse('2026-09-13T12:00:00.000Z'),
    networkAdapterFactory,
    uiControllerFactory,
    ...overrides
  });
  return { composition, root, adapters, controllers };
}

test('page composition derives tenant/location only from session resolver', async () => {
  const { composition, adapters, controllers } = harness();
  assert.equal(composition.mounted, false);
  assert.equal(adapters.length, 0);

  assert.equal(await composition.mount(), true);
  assert.equal(composition.mounted, true);
  assert.equal(adapters.length, 1);
  assert.equal(adapters[0].tenantId, 'tenant-session');
  assert.equal(adapters[0].locationId, 'location-session');
  assert.equal(adapters[0].start, '2026-09-06T12:00:00.000Z');
  assert.equal(adapters[0].end, '2026-09-13T12:00:00.000Z');
  assert.equal(controllers.length, 1);
  assert.equal(controllers[0].mounted, true);
});

test('period selection is whitelisted and cannot mutate session scope', async () => {
  const { composition, adapters, controllers } = harness();
  await composition.mount();

  assert.deepEqual(composition.periodOptions, [
    { key: '7d', label: '7 дней' },
    { key: '30d', label: '30 дней' },
    { key: '90d', label: '90 дней' }
  ]);
  assert.equal(composition.selectPeriod('30d'), true);
  assert.equal(composition.periodKey, '30d');
  assert.equal(adapters.length, 2);
  assert.equal(adapters[1].tenantId, 'tenant-session');
  assert.equal(adapters[1].locationId, 'location-session');
  assert.equal(adapters[1].start, '2026-08-14T12:00:00.000Z');
  assert.equal(adapters[1].end, '2026-09-13T12:00:00.000Z');
  assert.equal(controllers[0].mounted, false);
  assert.equal(controllers[1].mounted, true);

  assert.throws(() => composition.selectPeriod('custom'), /unsupported Dashboard period/u);
  assert.equal(adapters.length, 2);
});

test('invalid session scope fails closed before adapter or controller creation', async () => {
  const { composition, adapters, controllers, root } = harness({
    resolveSessionScope: async () => ({ tenantId: '', locationId: 'location-1' })
  });

  await assert.rejects(composition.mount(), /session tenantId/u);
  assert.equal(composition.mounted, false);
  assert.equal(adapters.length, 0);
  assert.equal(controllers.length, 0);
  assert.equal(root.children.length, 0);
});

test('unmount invalidates an in-flight session resolution', async () => {
  const pending = deferred();
  const { composition, adapters, controllers } = harness({ resolveSessionScope: () => pending.promise });

  const mounting = composition.mount();
  assert.equal(composition.mounted, true);
  assert.equal(composition.unmount(), true);
  pending.resolve({ tenantId: 'tenant-late', locationId: 'location-late' });

  assert.equal(await mounting, false);
  assert.equal(composition.mounted, false);
  assert.equal(adapters.length, 0);
  assert.equal(controllers.length, 0);
});

test('unmount clears scoped controller state and a remount resolves session again', async () => {
  let tenant = 'tenant-first';
  const { composition, adapters, controllers, root } = harness({
    resolveSessionScope: async () => ({ tenantId: tenant, locationId: null })
  });

  await composition.mount();
  assert.equal(adapters[0].tenantId, 'tenant-first');
  root.replaceChildren({ stale: true });
  assert.equal(composition.unmount(), true);
  assert.equal(root.children.length, 0);
  assert.equal(controllers[0].mounted, false);

  tenant = 'tenant-second';
  assert.equal(await composition.mount(), true);
  assert.equal(adapters[1].tenantId, 'tenant-second');
  assert.equal(adapters[1].locationId, null);
});

test('composition contract forbids caller-controlled scope and production auto-wiring', () => {
  assert.equal(dashboardPageCompositionContract.scopeSource, 'authorized-session-resolver-only');
  assert.equal(dashboardPageCompositionContract.acceptsTenantFromDom, false);
  assert.equal(dashboardPageCompositionContract.acceptsTenantFromUrl, false);
  assert.equal(dashboardPageCompositionContract.acceptsLocationFromDom, false);
  assert.equal(dashboardPageCompositionContract.acceptsLocationFromUrl, false);
  assert.deepEqual(dashboardPageCompositionContract.supportedPeriods, ['7d', '30d', '90d']);
  assert.equal(dashboardPageCompositionContract.productionNavigationWiring, false);
  assert.equal(dashboardPageCompositionContract.dependenciesAdded, false);
  assert.equal(dashboardPageCompositionContract.environmentVariablesAdded, false);
});
