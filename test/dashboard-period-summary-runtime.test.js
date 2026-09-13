import assert from 'node:assert/strict';
import test from 'node:test';

import { createDashboardPeriodSummaryRuntime } from '../dashboard-period-summary-runtime.js';

const aggregateRow = {
  current_completed_ops: 2,
  current_check_cents: '3000',
  current_bonus_issued: '30',
  current_bonus_spent: '10',
  current_active_clients: 2,
  previous_completed_ops: 1,
  previous_check_cents: '1000',
  previous_bonus_issued: '10',
  previous_bonus_spent: '5',
  previous_active_clients: 1
};

test('fails closed before querying while scoped Dashboard reads are disabled', async () => {
  let queryCalls = 0;
  const runtime = createDashboardPeriodSummaryRuntime({
    db: { async query() { queryCalls += 1; return { rows: [aggregateRow] }; } },
    scopedReadsEnabled: false
  });

  await assert.rejects(
    () => runtime.getPeriodSummary({
      tenantId: 'tenant-1',
      start: '2026-09-01T00:00:00.000Z',
      end: '2026-09-08T00:00:00.000Z'
    }),
    (error) => error?.code === 'scoped_reads_disabled' && error?.statusCode === 503
  );
  assert.equal(queryCalls, 0);
});

test('composes repository and formula service when explicitly enabled', async () => {
  const calls = [];
  const runtime = createDashboardPeriodSummaryRuntime({
    db: {
      async query(sql, params) {
        calls.push({ sql, params });
        return { rows: [aggregateRow] };
      }
    },
    scopedReadsEnabled: true
  });

  const summary = await runtime.getPeriodSummary({
    tenantId: 'tenant-1',
    locationId: 'location-1',
    start: '2026-09-01T00:00:00.000Z',
    end: '2026-09-08T00:00:00.000Z'
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [
    'tenant-1',
    'location-1',
    '2026-08-25T00:00:00.000Z',
    '2026-09-01T00:00:00.000Z',
    '2026-09-08T00:00:00.000Z'
  ]);
  assert.equal(summary.metrics.completedOps.current, 2);
  assert.equal(summary.metrics.averageCheckCents.current, 1500);
  assert.equal(summary.metrics.activeClients.changePercent.value, 100);
});

test('validates runtime dependencies', () => {
  assert.throws(() => createDashboardPeriodSummaryRuntime(), /db\.query is required/);
  assert.throws(
    () => createDashboardPeriodSummaryRuntime({ db: { query() {} }, scopedReadsEnabled: 'yes' }),
    /scopedReadsEnabled must be boolean/
  );
});
