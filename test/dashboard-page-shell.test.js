import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardPageShell, dashboardPageShellContract } from '../dashboard-page-shell.js';

class FakeNode {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.hidden = false;
    this.disabled = false;
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.listeners = new Map();
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
}

const documentRef = { createElement: (tagName) => new FakeNode(tagName) };

function okJson(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  };
}

function summary() {
  const available = (current, previous, value = 0) => ({
    current,
    previous,
    changePercent: { status: 'available', value, reason: null }
  });
  return {
    period: { start: '2026-09-07T00:00:00.000Z', end: '2026-09-14T00:00:00.000Z' },
    comparisonPeriod: { start: '2026-08-31T00:00:00.000Z', end: '2026-09-07T00:00:00.000Z' },
    metrics: {
      completedOps: available(10, 8, 25),
      checkCents: available(100000, 80000, 25),
      averageCheckCents: available(10000, 10000, 0),
      bonusIssued: available(500, 400, 25),
      bonusSpent: available(250, 200, 25),
      activeClients: available(6, 5, 20)
    }
  };
}

function collect(node, predicate, result = []) {
  if (predicate(node)) result.push(node);
  for (const child of node.children) collect(child, predicate, result);
  return result;
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function directoryFetch(calls, { initialTenant = 'tenant-a' } = {}) {
  return async (url, options = {}) => {
    calls.push({ url, options });
    if (url === '/api/spaceverse/session/dashboard-scope') {
      return okJson({ ok: true, scope: { tenantId: initialTenant, locationId: null } });
    }
    if (url === '/api/spaceverse/session/dashboard-scopes') {
      return okJson({
        ok: true,
        tenants: [
          { tenantId: 'tenant-a', displayName: 'Бар А' },
          { tenantId: 'tenant-b', displayName: 'Бар Б' }
        ]
      });
    }
    if (url === '/api/spaceverse/session/dashboard-scopes?tenantId=tenant-a') {
      return okJson({
        ok: true,
        tenant: { tenantId: 'tenant-a', displayName: 'Бар А' },
        locations: [{ locationId: 'location-a1', displayName: 'Основной зал' }]
      });
    }
    if (url === '/api/spaceverse/session/dashboard-scopes?tenantId=tenant-b') {
      return okJson({
        ok: true,
        tenant: { tenantId: 'tenant-b', displayName: 'Бар Б' },
        locations: [{ locationId: 'location-b1', displayName: 'Точка Б1' }]
      });
    }
    if (url === '/api/spaceverse/session/dashboard-scope/select') {
      const payload = JSON.parse(options.body);
      return okJson({ ok: true, scope: { tenantId: payload.tenantId, locationId: payload.locationId ?? null } });
    }
    if (url.includes('/period-summary?')) return okJson({ ok: true, summary: summary() });
    if (url.includes('/drilldown/completed_ops?')) {
      return okJson({
        ok: true,
        drilldown: { rowKind: 'transaction', rows: [], hasMore: false, limit: 50, offset: 0 }
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
}

test('authorized page shell drives fixed session scope -> summary -> drilldown browser flow', async () => {
  const root = new FakeNode('main');
  const calls = [];
  const shell = createDashboardPageShell({
    root,
    documentRef,
    fetchImpl: directoryFetch(calls),
    clock: () => Date.parse('2026-09-14T00:00:00.000Z')
  });

  assert.equal(shell.mounted, false);
  assert.equal(await shell.mount(), true);
  await settle();

  assert.equal(calls[0].url, '/api/spaceverse/session/dashboard-scope');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.ok(calls.some((call) => call.url === '/api/spaceverse/session/dashboard-scopes'));
  assert.ok(calls.some((call) => call.url === '/api/spaceverse/session/dashboard-scopes?tenantId=tenant-a'));

  const summaryCall = calls.find((call) => call.url.includes('/period-summary?'));
  assert.ok(summaryCall);
  assert.match(summaryCall.url, /^\/api\/spaceverse\/tenants\/tenant-a\/dashboard\/period-summary\?/u);
  assert.match(summaryCall.url, /start=2026-09-07T00%3A00%3A00.000Z/u);
  assert.match(summaryCall.url, /end=2026-09-14T00%3A00%3A00.000Z/u);
  assert.equal(summaryCall.url.includes('locationId='), false);

  const drilldownButton = collect(root, (node) => node.dataset?.drilldownMetric === 'completed_ops')[0];
  assert.ok(drilldownButton);
  drilldownButton.listeners.get('click')();
  await settle();

  assert.ok(calls.some((call) => call.url.includes('/drilldown/completed_ops?')));
  assert.equal(calls.filter((call) => call.url === '/api/spaceverse/session/dashboard-scope').length, 1);
});

test('period controls are explicit, accessible and cannot mutate server-derived scope', async () => {
  const root = new FakeNode('main');
  const calls = [];
  const shell = createDashboardPageShell({
    root,
    documentRef,
    fetchImpl: directoryFetch(calls),
    clock: () => Date.parse('2026-09-14T00:00:00.000Z')
  });
  await shell.mount();
  await settle();

  const buttons = collect(root, (node) => Boolean(node.dataset?.period));
  assert.deepEqual(buttons.map((button) => button.dataset.period), ['7d', '30d', '90d']);
  assert.equal(buttons[0].attributes.get('aria-pressed'), 'true');
  assert.equal(buttons[1].attributes.get('aria-pressed'), 'false');

  buttons[1].listeners.get('click')();
  await settle();

  assert.equal(buttons[0].attributes.get('aria-pressed'), 'false');
  assert.equal(buttons[1].attributes.get('aria-pressed'), 'true');
  const latestSummary = [...calls].reverse().find((call) => call.url.includes('/period-summary?'));
  assert.match(latestSummary.url, /^\/api\/spaceverse\/tenants\/tenant-a\/dashboard\/period-summary\?/u);
  assert.match(latestSummary.url, /start=2026-08-15T00%3A00%3A00.000Z/u);
  assert.equal(calls.filter((call) => call.url === '/api/spaceverse/session/dashboard-scope/select').length, 0);
});

test('scope selection required renders RBAC-filtered selectors without making scoped KPI requests', async () => {
  const root = new FakeNode('main');
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === '/api/spaceverse/session/dashboard-scope') {
      return okJson({ ok: false, error: 'scope_selection_required' }, 409);
    }
    if (url === '/api/spaceverse/session/dashboard-scopes') {
      return okJson({
        ok: true,
        tenants: [{ tenantId: 'tenant-a', displayName: 'Бар А' }]
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const shell = createDashboardPageShell({ root, documentRef, fetchImpl });
  assert.equal(await shell.mount(), true);
  await settle();

  const tenant = collect(root, (node) => node.dataset?.scopeSelector === 'tenant')[0];
  const location = collect(root, (node) => node.dataset?.scopeSelector === 'location')[0];
  assert.ok(tenant);
  assert.ok(location);
  assert.equal(tenant.disabled, false);
  assert.equal(location.disabled, true);
  assert.equal(tenant.children[1].value, 'tenant-a');
  assert.equal(calls.some((call) => call.url.includes('/period-summary?')), false);
});

test('tenant switch tears down old Dashboard before selection resolves and mounts only server-returned scope', async () => {
  const root = new FakeNode('main');
  const calls = [];
  let resolveSelection;
  const selectionResponse = new Promise((resolve) => { resolveSelection = resolve; });
  const baseFetch = directoryFetch(calls);
  const fetchImpl = async (url, options = {}) => {
    if (url === '/api/spaceverse/session/dashboard-scope/select') {
      calls.push({ url, options });
      return selectionResponse;
    }
    return baseFetch(url, options);
  };

  const shell = createDashboardPageShell({
    root,
    documentRef,
    fetchImpl,
    clock: () => Date.parse('2026-09-14T00:00:00.000Z')
  });
  await shell.mount();
  await settle();

  assert.ok(collect(root, (node) => node.dataset?.drilldownMetric === 'completed_ops').length > 0);
  const tenant = collect(root, (node) => node.dataset?.scopeSelector === 'tenant')[0];
  tenant.value = 'tenant-b';
  tenant.listeners.get('change')();
  await settle();

  assert.equal(collect(root, (node) => node.dataset?.drilldownMetric === 'completed_ops').length, 0);
  assert.equal(collect(root, (node) => node.className.includes('sv-dashboard-state--loading')).length, 1);
  assert.equal(calls.some((call) => call.url.includes('/tenants/tenant-b/dashboard/period-summary?')), false);

  resolveSelection(okJson({ ok: true, scope: { tenantId: 'tenant-b', locationId: null } }));
  await settle();
  await settle();

  assert.ok(calls.some((call) => call.url.includes('/tenants/tenant-b/dashboard/period-summary?')));
  assert.ok(calls.some((call) => call.url === '/api/spaceverse/session/dashboard-scopes?tenantId=tenant-b'));
  assert.equal(calls.filter((call) => call.url.includes('/tenants/tenant-a/dashboard/period-summary?')).length, 1);
});

test('location switch is server revalidated and scopes KPI reads to selected location', async () => {
  const root = new FakeNode('main');
  const calls = [];
  const shell = createDashboardPageShell({
    root,
    documentRef,
    fetchImpl: directoryFetch(calls),
    clock: () => Date.parse('2026-09-14T00:00:00.000Z')
  });
  await shell.mount();
  await settle();

  const location = collect(root, (node) => node.dataset?.scopeSelector === 'location')[0];
  assert.equal(location.disabled, false);
  location.value = 'location-a1';
  location.listeners.get('change')();
  await settle();
  await settle();

  const selectCall = [...calls].reverse().find((call) => call.url === '/api/spaceverse/session/dashboard-scope/select');
  assert.deepEqual(JSON.parse(selectCall.options.body), { tenantId: 'tenant-a', locationId: 'location-a1' });
  const latestSummary = [...calls].reverse().find((call) => call.url.includes('/period-summary?'));
  assert.match(latestSummary.url, /locationId=location-a1/u);
});

test('server selection mismatch fails closed without issuing KPI read for requested tenant', async () => {
  const root = new FakeNode('main');
  const calls = [];
  const baseFetch = directoryFetch(calls);
  const fetchImpl = async (url, options = {}) => {
    if (url === '/api/spaceverse/session/dashboard-scope/select') {
      calls.push({ url, options });
      return okJson({ ok: true, scope: { tenantId: 'tenant-a', locationId: null } });
    }
    return baseFetch(url, options);
  };
  const shell = createDashboardPageShell({ root, documentRef, fetchImpl });
  await shell.mount();
  await settle();

  const tenant = collect(root, (node) => node.dataset?.scopeSelector === 'tenant')[0];
  tenant.value = 'tenant-b';
  tenant.listeners.get('change')();
  await settle();
  await settle();

  assert.equal(calls.some((call) => call.url.includes('/tenants/tenant-b/dashboard/period-summary?')), false);
  assert.equal(collect(root, (node) => node.className.includes('sv-dashboard-state--error')).length, 1);
});

test('page shell stays isolated from production navigation and client scope authority', () => {
  assert.equal(dashboardPageShellContract.autoMount, false);
  assert.equal(dashboardPageShellContract.productionNavigationWiring, false);
  assert.equal(dashboardPageShellContract.tenantInputAcceptedAsAuthority, false);
  assert.equal(dashboardPageShellContract.locationInputAcceptedAsAuthority, false);
  assert.equal(dashboardPageShellContract.selectorAuthoritySource, 'server-validated-selection-response-only');
  assert.equal(dashboardPageShellContract.teardownBeforeScopeDataReload, true);
  assert.deepEqual(dashboardPageShellContract.periodControls, ['7d', '30d', '90d']);
});
