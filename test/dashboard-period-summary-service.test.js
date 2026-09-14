import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDashboardPeriodSummaryService,
  dashboardPeriodSummaryServiceContract
} from '../dashboard-period-summary-service.js';

const PERIOD = Object.freeze({
  start: '2026-09-01T00:00:00.000Z',
  end: '2026-09-08T00:00:00.000Z'
});

const COMPARISON_PERIOD = Object.freeze({
  start: '2026-08-25T00:00:00.000Z',
  end: '2026-09-01T00:00:00.000Z'
});

function rawSummary(overrides = {}) {
  return {
    period: PERIOD,
    comparisonPeriod: COMPARISON_PERIOD,
    metrics: {
      current_completed_ops: 10,
      current_check_cents: '120000',
      current_bonus_issued: '1200',
      current_bonus_spent: '400',
      current_active_clients: 7,
      previous_completed_ops: 8,
      previous_check_cents: '100000',
      previous_bonus_issued: '1000',
      previous_bonus_spent: '500',
      previous_active_clients: 5,
      ...overrides
    }
  };
}

test('dashboard KPI service preserves scope delegation and exposes deterministic formulas', async () => {
  const scopes = [];
  const getSummary = createDashboardPeriodSummaryService({
    async loadPeriodSummary(scope) {
      scopes.push(scope);
      return rawSummary();
    }
  });

  const scope = { tenantId: 'tenant-a', locationId: 'location-7', ...PERIOD };
  const result = await getSummary(scope);

  assert.equal(scopes.length, 1);
  assert.equal(scopes[0], scope);
  assert.deepEqual(result.period, PERIOD);
  assert.deepEqual(result.comparisonPeriod, COMPARISON_PERIOD);

  assert.deepEqual(result.metrics.completedOps, {
    current: 10,
    previous: 8,
    changePercent: { value: 25, status: 'available', reason: null }
  });
  assert.deepEqual(result.metrics.checkCents, {
    current: 120000,
    previous: 100000,
    changePercent: { value: 20, status: 'available', reason: null }
  });
  assert.deepEqual(result.metrics.averageCheckCents, {
    current: 12000,
    previous: 12500,
    changePercent: { value: -4, status: 'available', reason: null }
  });
  assert.deepEqual(result.metrics.bonusSpent.changePercent, {
    value: -20,
    status: 'available',
    reason: null
  });
  assert.deepEqual(result.metrics.activeClients.changePercent, {
    value: 40,
    status: 'available',
    reason: null
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.metrics), true);
});

test('dashboard KPI service reports N/A instead of inventing percentage change from zero base', async () => {
  const getSummary = createDashboardPeriodSummaryService({
    async loadPeriodSummary() {
      return rawSummary({
        previous_completed_ops: 0,
        previous_check_cents: '0',
        previous_bonus_issued: '0',
        previous_bonus_spent: '0',
        previous_active_clients: 0
      });
    }
  });

  const result = await getSummary({ tenantId: 'tenant-a', ...PERIOD });

  for (const name of ['completedOps', 'checkCents', 'bonusIssued', 'bonusSpent', 'activeClients']) {
    assert.deepEqual(result.metrics[name].changePercent, {
      value: null,
      status: 'not_available',
      reason: 'previous_period_zero'
    });
  }
  assert.deepEqual(result.metrics.averageCheckCents, {
    current: 12000,
    previous: null,
    changePercent: {
      value: null,
      status: 'not_available',
      reason: 'previous_period_no_completed_ops'
    }
  });
});

test('average check is unavailable for a current period with no completed operations', async () => {
  const getSummary = createDashboardPeriodSummaryService({
    async loadPeriodSummary() {
      return rawSummary({
        current_completed_ops: 0,
        current_check_cents: '0'
      });
    }
  });

  const result = await getSummary({ tenantId: 'tenant-a', ...PERIOD });
  assert.deepEqual(result.metrics.averageCheckCents, {
    current: null,
    previous: 12500,
    changePercent: {
      value: null,
      status: 'not_available',
      reason: 'current_period_no_completed_ops'
    }
  });
});

test('dashboard KPI service rounds percentage changes to one decimal place', async () => {
  const getSummary = createDashboardPeriodSummaryService({
    async loadPeriodSummary() {
      return rawSummary({
        current_completed_ops: 4,
        previous_completed_ops: 3
      });
    }
  });

  const result = await getSummary({ tenantId: 'tenant-a', ...PERIOD });
  assert.equal(result.metrics.completedOps.changePercent.value, 33.3);
});

test('dashboard KPI service fails closed on unsafe or malformed aggregate values', async () => {
  for (const metrics of [
    { current_check_cents: '-1' },
    { current_check_cents: '1.5' },
    { current_check_cents: '9007199254740992' },
    { current_active_clients: null },
    { previous_completed_ops: Number.NaN }
  ]) {
    const getSummary = createDashboardPeriodSummaryService({
      async loadPeriodSummary() {
        return rawSummary(metrics);
      }
    });
    await assert.rejects(
      getSummary({ tenantId: 'tenant-a', ...PERIOD }),
      /safe non-negative integer/
    );
  }
});

test('dashboard KPI service fails closed on malformed repository response', async () => {
  const missing = createDashboardPeriodSummaryService({
    async loadPeriodSummary() {
      return null;
    }
  });
  await assert.rejects(missing({ tenantId: 'tenant-a', ...PERIOD }), /must return an object/);

  const missingPeriod = createDashboardPeriodSummaryService({
    async loadPeriodSummary() {
      return { metrics: rawSummary().metrics, comparisonPeriod: COMPARISON_PERIOD };
    }
  });
  await assert.rejects(missingPeriod({ tenantId: 'tenant-a', ...PERIOD }), /period is required/);
});

test('dashboard KPI contract documents formulas and excludes synthetic or unscoped client counts', () => {
  assert.equal(
    dashboardPeriodSummaryServiceContract.formulas.averageCheckCents,
    'rounded checkCents / completedOps; unavailable when completedOps = 0'
  );
  assert.equal(
    dashboardPeriodSummaryServiceContract.formulas.changePercent,
    'round(((current - previous) / previous) * 100, 1); unavailable when previous = 0'
  );
  assert.equal(dashboardPeriodSummaryServiceContract.registeredClientsIncluded, false);
  assert.equal(dashboardPeriodSummaryServiceContract.syntheticMetricsIncluded, false);
  assert.equal(dashboardPeriodSummaryServiceContract.productionWiringEnabled, false);
});

test('dashboard KPI service requires a repository loader', () => {
  assert.throws(
    () => createDashboardPeriodSummaryService({}),
    /loadPeriodSummary must be a function/
  );
});
