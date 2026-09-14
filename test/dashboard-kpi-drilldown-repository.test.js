import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSqlDashboardKpiDrilldownRepository,
  dashboardKpiDrilldownRepositoryContract
} from '../dashboard-kpi-drilldown-repository.js';

const READ_ONLY_PATTERN = /\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|DROP|CREATE)\b/i;
const PERIOD = Object.freeze({
  start: '2026-09-01T00:00:00.000Z',
  end: '2026-09-08T00:00:00.000Z'
});

test('transaction KPI drilldown keeps tenant and optional location scope with half-open period', async () => {
  const calls = [];
  const load = createSqlDashboardKpiDrilldownRepository({
    async query(sql, params) {
      calls.push({ sql, params });
      return {
        rows: [{ id: 'tx-2', client_id: 'c-2' }, { id: 'tx-1', client_id: 'c-1' }]
      };
    }
  });

  const result = await load({
    tenantId: ' tenant-a ',
    locationId: ' location-7 ',
    metric: 'check_cents',
    ...PERIOD,
    limit: 1,
    offset: 0
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [
    'tenant-a',
    'location-7',
    PERIOD.start,
    PERIOD.end,
    2,
    0
  ]);
  assert.match(calls[0].sql, /t\.tenant_id\s*=\s*\$1/i);
  assert.match(calls[0].sql, /t\.location_id\s*=\s*\$2/i);
  assert.match(calls[0].sql, /t\.created_at\s*>=\s*\$3/i);
  assert.match(calls[0].sql, /t\.created_at\s*<\s*\$4/i);
  assert.match(calls[0].sql, /t\.status\s*=\s*'completed'/i);
  assert.match(calls[0].sql, /ORDER BY t\.created_at DESC, t\.id DESC/i);
  assert.doesNotMatch(calls[0].sql, /tenant-a|location-7/);
  assert.doesNotMatch(calls[0].sql, READ_ONLY_PATTERN);
  assert.equal(result.metric, 'check_cents');
  assert.equal(result.rowKind, 'transaction');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].id, 'tx-2');
  assert.equal(result.hasMore, true);
  assert.deepEqual(result.period, PERIOD);
});

test('active_clients drilldown returns one non-null client group matching COUNT DISTINCT semantics', async () => {
  let sql = '';
  const load = createSqlDashboardKpiDrilldownRepository({
    async query(text) {
      sql = text;
      return { rows: [{ client_id: 'c-1', completed_ops: 3 }] };
    }
  });

  const result = await load({ tenantId: 'tenant-a', metric: 'active_clients', ...PERIOD });

  assert.equal(result.rowKind, 'client');
  assert.match(sql, /GROUP BY t\.client_id/i);
  assert.match(sql, /t\.client_id IS NOT NULL/i);
  assert.match(sql, /COUNT\(\*\)::int AS completed_ops/i);
  assert.match(sql, /SUM\(t\.check_amount_cents\)/i);
  assert.match(sql, /MAX\(t\.created_at\) AS last_activity_at/i);
  assert.doesNotMatch(sql, READ_ONLY_PATTERN);
});

test('drilldown rejects unsupported metric, malformed scope, period and pagination before query', async () => {
  let queried = false;
  const load = createSqlDashboardKpiDrilldownRepository({
    async query() {
      queried = true;
      return { rows: [] };
    }
  });

  await assert.rejects(load({ tenantId: 'tenant-a', metric: 'ltv', ...PERIOD }), /metric is not supported/);
  await assert.rejects(load({ metric: 'check_cents', ...PERIOD }), /tenantId is required/);
  await assert.rejects(load({ tenantId: ' ', metric: 'check_cents', ...PERIOD }), /tenantId must be a non-empty identifier/);
  await assert.rejects(load({ tenantId: 'tenant-a', locationId: ' ', metric: 'check_cents', ...PERIOD }), /locationId must be a non-empty identifier/);
  await assert.rejects(load({ tenantId: 'tenant-a', metric: 'check_cents', start: 'bad', end: PERIOD.end }), /period.start must be a valid timestamp/);
  await assert.rejects(load({ tenantId: 'tenant-a', metric: 'check_cents', start: PERIOD.end, end: PERIOD.start }), /period.end must be after period.start/);
  await assert.rejects(load({ tenantId: 'tenant-a', metric: 'check_cents', ...PERIOD, limit: 101 }), /limit must be an integer between 1 and 100/);
  await assert.rejects(load({ tenantId: 'tenant-a', metric: 'check_cents', ...PERIOD, offset: -1 }), /offset must be an integer/);
  assert.equal(queried, false);
});

test('drilldown fails closed on malformed query result', async () => {
  const load = createSqlDashboardKpiDrilldownRepository({
    async query() {
      return { rowCount: 0 };
    }
  });
  await assert.rejects(load({ tenantId: 'tenant-a', metric: 'completed_ops', ...PERIOD }), /rows\[\]/);
});

test('drilldown contract stays read-only and limited to real Dashboard metrics', () => {
  assert.deepEqual(dashboardKpiDrilldownRepositoryContract.supportedMetrics, [
    'completed_ops',
    'check_cents',
    'bonus_issued',
    'bonus_spent',
    'active_clients'
  ]);
  assert.equal(dashboardKpiDrilldownRepositoryContract.periodSemantics, '[start,end)');
  assert.equal(dashboardKpiDrilldownRepositoryContract.completedTransactionsOnly, true);
  assert.equal(dashboardKpiDrilldownRepositoryContract.productionWiringEnabled, false);
  assert.equal(dashboardKpiDrilldownRepositoryContract.externalDependenciesAdded, false);
});

test('drilldown repository requires injected query function', () => {
  assert.throws(() => createSqlDashboardKpiDrilldownRepository({}), /query must be a function/);
});
