import assert from 'node:assert/strict';
import test from 'node:test';

import { createDashboardKpiDrilldownRuntime } from '../dashboard-kpi-drilldown-runtime.js';

test('fails closed before querying while scoped Dashboard reads are disabled', async () => {
  let queryCalls = 0;
  const runtime = createDashboardKpiDrilldownRuntime({
    db: { async query() { queryCalls += 1; return { rows: [] }; } },
    scopedReadsEnabled: false
  });

  await assert.rejects(
    () => runtime.getKpiDrilldown({
      tenantId: 'tenant-1',
      metric: 'completed_ops',
      start: '2026-09-01T00:00:00.000Z',
      end: '2026-09-08T00:00:00.000Z'
    }),
    (error) => error?.code === 'scoped_reads_disabled' && error?.statusCode === 503
  );
  assert.equal(queryCalls, 0);
});

test('delegates scoped drilldown reads when explicitly enabled', async () => {
  const calls = [];
  const runtime = createDashboardKpiDrilldownRuntime({
    db: {
      async query(sql, params) {
        calls.push({ sql, params });
        return { rows: [{ id: 'tx-1' }] };
      }
    },
    scopedReadsEnabled: true
  });

  const result = await runtime.getKpiDrilldown({
    tenantId: 'tenant-1',
    locationId: 'location-1',
    metric: 'completed_ops',
    start: '2026-09-01T00:00:00.000Z',
    end: '2026-09-08T00:00:00.000Z',
    limit: 25,
    offset: 5
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /t\.tenant_id = \$1/);
  assert.match(calls[0].sql, /t\.location_id = \$2/);
  assert.deepEqual(calls[0].params, [
    'tenant-1', 'location-1',
    '2026-09-01T00:00:00.000Z', '2026-09-08T00:00:00.000Z',
    26, 5
  ]);
  assert.equal(result.rows.length, 1);
});

test('validates runtime dependencies', () => {
  assert.throws(() => createDashboardKpiDrilldownRuntime(), /db\.query is required/);
  assert.throws(
    () => createDashboardKpiDrilldownRuntime({ db: { query() {} }, scopedReadsEnabled: 'yes' }),
    /scopedReadsEnabled must be boolean/
  );
});
