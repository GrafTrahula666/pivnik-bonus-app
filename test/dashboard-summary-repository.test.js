import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSqlDashboardSummaryRepository,
  dashboardSummaryRepositoryContract
} from '../dashboard-summary-repository.js';

const READ_ONLY_PATTERN = /\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|DROP|CREATE)\b/i;

test('dashboard summary repository scopes every query by tenant with a parameter', async () => {
  const calls = [];
  const loadSummary = createSqlDashboardSummaryRepository({
    async query(sql, params) {
      calls.push({ sql, params });
      return {
        rows: [{
          issued: '1200',
          today_ops: 4,
          today_check_cents: '650000',
          suspicious_ops: 1,
          cancelled_today: 0
        }]
      };
    }
  });

  const row = await loadSummary({ tenantId: ' tenant-a ' });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, ['tenant-a']);
  assert.match(calls[0].sql, /^\s*SELECT\b/i);
  assert.match(calls[0].sql, /FROM\s+transactions\b/i);
  assert.match(calls[0].sql, /tenant_id\s*=\s*\$1/i);
  assert.doesNotMatch(calls[0].sql, /location_id\s*=\s*\$2/i);
  assert.doesNotMatch(calls[0].sql, READ_ONLY_PATTERN);
  assert.equal(Object.isFrozen(row), true);
});

test('dashboard summary repository adds location scope without weakening tenant scope', async () => {
  const calls = [];
  const loadSummary = createSqlDashboardSummaryRepository({
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{}] };
    }
  });

  await loadSummary({ tenantId: 'tenant-a', locationId: 'location-7' });

  assert.deepEqual(calls[0].params, ['tenant-a', 'location-7']);
  assert.match(calls[0].sql, /tenant_id\s*=\s*\$1/i);
  assert.match(calls[0].sql, /location_id\s*=\s*\$2/i);
  assert.doesNotMatch(calls[0].sql, /tenant-a|location-7/);
});

test('dashboard summary repository rejects missing tenant before querying', async () => {
  let queried = false;
  const loadSummary = createSqlDashboardSummaryRepository({
    async query() {
      queried = true;
      return { rows: [{}] };
    }
  });

  await assert.rejects(loadSummary({}), /tenantId is required/);
  await assert.rejects(loadSummary({ tenantId: '   ' }), /tenantId must be a non-empty identifier/);
  assert.equal(queried, false);
});

test('dashboard summary repository rejects blank explicit location before querying', async () => {
  let queried = false;
  const loadSummary = createSqlDashboardSummaryRepository({
    async query() {
      queried = true;
      return { rows: [{}] };
    }
  });

  await assert.rejects(
    loadSummary({ tenantId: 'tenant-a', locationId: '   ' }),
    /locationId must be a non-empty identifier/
  );
  assert.equal(queried, false);
});

test('dashboard summary repository fails closed on malformed aggregate results', async () => {
  const malformed = createSqlDashboardSummaryRepository({
    async query() {
      return { rowCount: 1 };
    }
  });
  await assert.rejects(malformed({ tenantId: 'tenant-a' }), /rows\[\]/);

  const duplicate = createSqlDashboardSummaryRepository({
    async query() {
      return { rows: [{}, {}] };
    }
  });
  await assert.rejects(duplicate({ tenantId: 'tenant-a' }), /exactly one aggregate row/);
});

test('dashboard contract defers clients KPI until user tenant attribution exists', () => {
  assert.deepEqual(dashboardSummaryRepositoryContract.requiredFutureColumns, ['tenant_id', 'location_id']);
  assert.deepEqual(dashboardSummaryRepositoryContract.returnedMetrics, [
    'issued',
    'today_ops',
    'today_check_cents',
    'suspicious_ops',
    'cancelled_today'
  ]);
  assert.equal(dashboardSummaryRepositoryContract.intentionallyDeferredMetrics[0].metric, 'clients');
  assert.match(
    dashboardSummaryRepositoryContract.intentionallyDeferredMetrics[0].reason,
    /tenant-attribution/
  );
});

test('dashboard summary repository requires an injected query function', () => {
  assert.throws(() => createSqlDashboardSummaryRepository({}), /query must be a function/);
});
