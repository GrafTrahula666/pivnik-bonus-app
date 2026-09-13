import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardNetworkAdapter, dashboardNetworkAdapterContract } from '../dashboard-network-adapter.js';

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => payload };
}

const summary = {
  period: { start: '2026-09-01T00:00:00.000Z', end: '2026-09-08T00:00:00.000Z' },
  comparisonPeriod: { start: '2026-08-25T00:00:00.000Z', end: '2026-09-01T00:00:00.000Z' },
  metrics: {}
};

function adapterWith(fetchImpl) {
  return createDashboardNetworkAdapter({
    tenantId: 'tenant / one',
    locationId: 'location-1',
    start: '2026-09-01T00:00:00.000Z',
    end: '2026-09-08T00:00:00.000Z',
    fetchImpl
  });
}

test('summary request is same-origin GET with encoded tenant, location and explicit period', async () => {
  const calls = [];
  const adapter = adapterWith(async (...args) => {
    calls.push(args);
    return jsonResponse({ ok: true, summary });
  });

  assert.equal(await adapter.loadSummary(), summary);
  assert.equal(calls.length, 1);
  const [url, options] = calls[0];
  assert.match(url, /^\/api\/spaceverse\/tenants\/tenant%20%2F%20one\/dashboard\/period-summary\?/u);
  const parsed = new URL(url, 'https://example.test');
  assert.equal(parsed.searchParams.get('start'), '2026-09-01T00:00:00.000Z');
  assert.equal(parsed.searchParams.get('end'), '2026-09-08T00:00:00.000Z');
  assert.equal(parsed.searchParams.get('locationId'), 'location-1');
  assert.deepEqual(options, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' }
  });
});

test('drilldown request carries bounded pagination and only supported metric paths', async () => {
  const calls = [];
  const adapter = adapterWith(async (...args) => {
    calls.push(args);
    return jsonResponse({ ok: true, drilldown: { rowKind: 'transaction', rows: [], limit: 25, offset: 50, hasMore: false } });
  });

  const result = await adapter.loadDrilldown('completed_ops', { limit: 25, offset: 50 });
  assert.equal(result.ok, true);
  const parsed = new URL(calls[0][0], 'https://example.test');
  assert.equal(parsed.pathname, '/api/spaceverse/tenants/tenant%20%2F%20one/dashboard/drilldown/completed_ops');
  assert.equal(parsed.searchParams.get('limit'), '25');
  assert.equal(parsed.searchParams.get('offset'), '50');

  await assert.rejects(() => adapter.loadDrilldown('../users'), /unsupported Dashboard drilldown metric/u);
  await assert.rejects(() => adapter.loadDrilldown('completed_ops', { limit: 101, offset: 0 }), /between 1 and 100/u);
  await assert.rejects(() => adapter.loadDrilldown('completed_ops', { limit: 50, offset: -1 }), /non-negative/u);
  assert.equal(calls.length, 1);
});

test('adapter rejects cross-origin base paths before any request', () => {
  const fetchImpl = async () => { throw new Error('must not run'); };
  assert.throws(() => createDashboardNetworkAdapter({
    tenantId: 'tenant-1',
    start: '2026-09-01T00:00:00Z',
    end: '2026-09-02T00:00:00Z',
    fetchImpl,
    basePath: 'https://evil.example/api'
  }), /same-origin absolute path/u);
  assert.throws(() => createDashboardNetworkAdapter({
    tenantId: 'tenant-1',
    start: '2026-09-01T00:00:00Z',
    end: '2026-09-02T00:00:00Z',
    fetchImpl,
    basePath: '//evil.example/api'
  }), /same-origin absolute path/u);
});

test('adapter fails closed on HTTP errors, non-ok envelopes and malformed payloads', async () => {
  const errorAdapter = adapterWith(async () => jsonResponse({ ok: false, error: 'Forbidden', code: 'forbidden' }, { ok: false, status: 403 }));
  await assert.rejects(errorAdapter.loadSummary, (error) => error.statusCode === 403 && error.code === 'forbidden');

  const envelopeAdapter = adapterWith(async () => jsonResponse({ ok: false, error: 'Nope' }));
  await assert.rejects(envelopeAdapter.loadSummary, /Nope/u);

  const missingSummaryAdapter = adapterWith(async () => jsonResponse({ ok: true }));
  await assert.rejects(missingSummaryAdapter.loadSummary, /summary is missing/u);

  const missingDrilldownAdapter = adapterWith(async () => jsonResponse({ ok: true }));
  await assert.rejects(() => missingDrilldownAdapter.loadDrilldown('active_clients'), /drilldown is missing/u);

  const invalidJsonAdapter = adapterWith(async () => ({ ok: true, status: 200, json: async () => { throw new Error('parse'); } }));
  await assert.rejects(invalidJsonAdapter.loadSummary, (error) => error.code === 'dashboard_invalid_json');
});

test('adapter validates scope and period before requests', () => {
  const base = {
    fetchImpl: async () => jsonResponse({ ok: true, summary }),
    start: '2026-09-01T00:00:00Z',
    end: '2026-09-02T00:00:00Z'
  };
  assert.throws(() => createDashboardNetworkAdapter({ ...base, tenantId: '' }), /tenantId/u);
  assert.throws(() => createDashboardNetworkAdapter({ ...base, tenantId: 'tenant-1', start: 'bad-date' }), /valid timestamp/u);
  assert.throws(() => createDashboardNetworkAdapter({ ...base, tenantId: 'tenant-1', start: base.end, end: base.start }), /start must be before end/u);
});

test('network adapter contract remains read-only and dependency-free', () => {
  assert.equal(dashboardNetworkAdapterContract.readOnly, true);
  assert.equal(dashboardNetworkAdapterContract.sameOriginOnly, true);
  assert.equal(dashboardNetworkAdapterContract.credentials, 'same-origin');
  assert.equal(dashboardNetworkAdapterContract.maxPageSize, 100);
  assert.equal(dashboardNetworkAdapterContract.dependenciesAdded, false);
  assert.equal(dashboardNetworkAdapterContract.environmentVariablesAdded, false);
  assert.equal(dashboardNetworkAdapterContract.productionNavigationWiring, false);
});
