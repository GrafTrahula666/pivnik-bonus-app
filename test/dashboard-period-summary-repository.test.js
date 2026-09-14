import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSqlDashboardPeriodSummaryRepository,
  dashboardPeriodSummaryRepositoryContract
} from '../dashboard-period-summary-repository.js';

const READ_ONLY_PATTERN = /\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|DROP|CREATE)\b/i;

const PERIOD = Object.freeze({
  start: '2026-09-01T00:00:00.000Z',
  end: '2026-09-08T00:00:00.000Z'
});

test('dashboard period summary keeps tenant scope and computes equal previous period', async () => {
  const calls = [];
  const load = createSqlDashboardPeriodSummaryRepository({
    async query(sql, params) {
      calls.push({ sql, params });
      return {
        rows: [{
          current_completed_ops: 10,
          current_check_cents: '120000',
          current_bonus_issued: '1200',
          current_bonus_spent: '400',
          current_active_clients: 7,
          previous_completed_ops: 8,
          previous_check_cents: '99000',
          previous_bonus_issued: '1000',
          previous_bonus_spent: '350',
          previous_active_clients: 6
        }]
      };
    }
  });

  const result = await load({ tenantId: ' tenant-a ', ...PERIOD });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [
    'tenant-a',
    '2026-08-25T00:00:00.000Z',
    '2026-09-01T00:00:00.000Z',
    '2026-09-08T00:00:00.000Z'
  ]);
  assert.match(calls[0].sql, /tenant_id\s*=\s*\$1/i);
  assert.doesNotMatch(calls[0].sql, /location_id\s*=/i);
  assert.doesNotMatch(calls[0].sql, READ_ONLY_PATTERN);
  assert.deepEqual(result.period, PERIOD);
  assert.deepEqual(result.comparisonPeriod, {
    start: '2026-08-25T00:00:00.000Z',
    end: '2026-09-01T00:00:00.000Z'
  });
  assert.equal(result.metrics.current_active_clients, 7);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.metrics), true);
});

test('dashboard period summary adds exact location scope without weakening tenant scope', async () => {
  const calls = [];
  const load = createSqlDashboardPeriodSummaryRepository({
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{}] };
    }
  });

  await load({ tenantId: 'tenant-a', locationId: 'location-7', ...PERIOD });

  assert.deepEqual(calls[0].params, [
    'tenant-a',
    'location-7',
    '2026-08-25T00:00:00.000Z',
    '2026-09-01T00:00:00.000Z',
    '2026-09-08T00:00:00.000Z'
  ]);
  assert.match(calls[0].sql, /tenant_id\s*=\s*\$1/i);
  assert.match(calls[0].sql, /location_id\s*=\s*\$2/i);
  assert.doesNotMatch(calls[0].sql, /tenant-a|location-7/);
});

test('dashboard period query uses explicit half-open bounds and completed transactions only', async () => {
  let sql = '';
  const load = createSqlDashboardPeriodSummaryRepository({
    async query(text) {
      sql = text;
      return { rows: [{}] };
    }
  });

  await load({ tenantId: 'tenant-a', ...PERIOD });

  assert.match(sql, /status\s*=\s*'completed'/i);
  assert.match(sql, /created_at\s*>=\s*\$2/i);
  assert.match(sql, /created_at\s*<\s*\$3/i);
  assert.match(sql, /created_at\s*>=\s*\$3/i);
  assert.match(sql, /created_at\s*<\s*\$4/i);
  assert.match(sql, /COUNT\(DISTINCT\s+client_id\)/i);
  assert.doesNotMatch(sql, /CURRENT_DATE|CURRENT_TIMESTAMP|NOW\s*\(/i);
});

test('dashboard period summary rejects unsafe scope and malformed periods before querying', async () => {
  let queried = false;
  const load = createSqlDashboardPeriodSummaryRepository({
    async query() {
      queried = true;
      return { rows: [{}] };
    }
  });

  await assert.rejects(load({ ...PERIOD }), /tenantId is required/);
  await assert.rejects(load({ tenantId: '   ', ...PERIOD }), /tenantId must be a non-empty identifier/);
  await assert.rejects(load({ tenantId: 'tenant-a', locationId: '   ', ...PERIOD }), /locationId must be a non-empty identifier/);
  await assert.rejects(load({ tenantId: 'tenant-a', start: 'nope', end: PERIOD.end }), /period.start must be a valid timestamp/);
  await assert.rejects(load({ tenantId: 'tenant-a', start: PERIOD.end, end: PERIOD.start }), /period.end must be after period.start/);
  await assert.rejects(load({ tenantId: 'tenant-a', start: PERIOD.start, end: PERIOD.start }), /period.end must be after period.start/);
  assert.equal(queried, false);
});

test('dashboard period summary fails closed on malformed aggregate result', async () => {
  const malformed = createSqlDashboardPeriodSummaryRepository({
    async query() {
      return { rowCount: 1 };
    }
  });
  await assert.rejects(malformed({ tenantId: 'tenant-a', ...PERIOD }), /rows\[\]/);

  const duplicate = createSqlDashboardPeriodSummaryRepository({
    async query() {
      return { rows: [{}, {}] };
    }
  });
  await assert.rejects(duplicate({ tenantId: 'tenant-a', ...PERIOD }), /exactly one aggregate row/);
});

test('dashboard period contract documents real transaction-derived KPI semantics', () => {
  assert.deepEqual(dashboardPeriodSummaryRepositoryContract.metrics, [
    'completed_ops',
    'check_cents',
    'bonus_issued',
    'bonus_spent',
    'active_clients'
  ]);
  assert.equal(
    dashboardPeriodSummaryRepositoryContract.activeClientsDefinition,
    'distinct client_id with completed transaction in period'
  );
  assert.equal(dashboardPeriodSummaryRepositoryContract.registeredClientsIncluded, false);
  assert.equal(dashboardPeriodSummaryRepositoryContract.periodSemantics, '[start,end)');
  assert.equal(dashboardPeriodSummaryRepositoryContract.productionWiringEnabled, false);
});

test('dashboard period repository requires an injected query function', () => {
  assert.throws(() => createSqlDashboardPeriodSummaryRepository({}), /query must be a function/);
});
