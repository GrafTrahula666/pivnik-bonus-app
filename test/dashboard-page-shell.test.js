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

test('authorized page shell drives fixed session scope -> summary -> drilldown browser flow', async () => {
  const root = new FakeNode('main');
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/spaceverse/session/dashboard-scope') {
      return okJson({ ok: true, scope: { tenantId: 'tenant-a', locationId: null } });
    }
    if (url.startsWith('/api/spaceverse/tenants/tenant-a/dashboard/period-summary?')) {
      return okJson({ ok: true, summary: summary() });
    }
    if (url.startsWith('/api/spaceverse/tenants/tenant-a/dashboard/drilldown/completed_ops?')) {
      return okJson({
        ok: true,
        drilldown: { rowKind: 'transaction', rows: [], hasMore: false, limit: 50, offset: 0 }
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const shell = createDashboardPageShell({
    root,
    documentRef,
    fetchImpl,
    clock: () => Date.parse('2026-09-14T00:00:00.000Z')
  });

  assert.equal(shell.mounted, false);
  assert.equal(await shell.mount(), true);
  await settle();

  assert.equal(calls[0].url, '/api/spaceverse/session/dashboard-scope');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.credentials, 'same-origin');

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

  const drilldownCall = calls.find((call) => call.url.includes('/drilldown/completed_ops?'));
  assert.ok(drilldownCall);
  assert.match(drilldownCall.url, /limit=50/u);
  assert.match(drilldownCall.url, /offset=0/u);

  assert.equal(calls.filter((call) => call.url === '/api/spaceverse/session/dashboard-scope').length, 1);
});

test('period controls are explicit, accessible and cannot mutate server-derived scope', async () => {
  const root = new FakeNode('main');
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === '/api/spaceverse/session/dashboard-scope') {
      return okJson({ ok: true, scope: { tenantId: 'tenant-safe', locationId: 'location-safe' } });
    }
    if (url.includes('/period-summary?')) return okJson({ ok: true, summary: summary() });
    throw new Error(`Unexpected URL: ${url}`);
  };

  const shell = createDashboardPageShell({
    root,
    documentRef,
    fetchImpl,
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
  const latestSummary = [...calls].reverse().find((url) => url.includes('/period-summary?'));
  assert.match(latestSummary, /^\/api\/spaceverse\/tenants\/tenant-safe\/dashboard\/period-summary\?/u);
  assert.match(latestSummary, /locationId=location-safe/u);
  assert.match(latestSummary, /start=2026-08-15T00%3A00%3A00.000Z/u);
  assert.equal(calls.filter((url) => url === '/api/spaceverse/session/dashboard-scope').length, 1);
});

test('scope failure is fail-closed and renders a generic page error without scoped API calls', async () => {
  const root = new FakeNode('main');
  const calls = [];
  const shell = createDashboardPageShell({
    root,
    documentRef,
    fetchImpl: async (url) => {
      calls.push(url);
      return okJson({ ok: false, error: 'scope_selection_required' }, 409);
    }
  });

  assert.equal(await shell.mount(), false);
  await settle();
  assert.deepEqual(calls, ['/api/spaceverse/session/dashboard-scope']);
  assert.equal(collect(root, (node) => node.className.includes('sv-dashboard-state--error')).length, 1);
  assert.equal(collect(root, (node) => node.dataset?.drilldownMetric).length, 0);
});

test('page shell stays isolated from production navigation and scope inputs', () => {
  assert.equal(dashboardPageShellContract.autoMount, false);
  assert.equal(dashboardPageShellContract.productionNavigationWiring, false);
  assert.equal(dashboardPageShellContract.tenantInputAccepted, false);
  assert.equal(dashboardPageShellContract.locationInputAccepted, false);
  assert.deepEqual(dashboardPageShellContract.periodControls, ['7d', '30d', '90d']);
});
