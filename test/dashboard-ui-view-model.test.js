import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDashboardUiViewModel,
  dashboardUiViewModelContract
} from '../dashboard-ui-view-model.js';

function available(value) {
  return { value, status: 'available', reason: null };
}

function unavailable(reason) {
  return { value: null, status: 'not_available', reason };
}

function sampleSummary() {
  return {
    period: { start: '2026-09-01T00:00:00.000Z', end: '2026-09-08T00:00:00.000Z' },
    comparisonPeriod: { start: '2026-08-25T00:00:00.000Z', end: '2026-09-01T00:00:00.000Z' },
    metrics: {
      completedOps: { current: 120, previous: 100, changePercent: available(20) },
      checkCents: { current: 2500500, previous: 2000000, changePercent: available(25) },
      averageCheckCents: { current: 20838, previous: 20000, changePercent: available(4.2) },
      bonusIssued: { current: 12000, previous: 10000, changePercent: available(20) },
      bonusSpent: { current: 7000, previous: 7500, changePercent: available(-6.7) },
      activeClients: { current: 75, previous: 75, changePercent: available(0) }
    }
  };
}

test('maps the six confirmed Dashboard KPIs without synthetic metrics', () => {
  const model = createDashboardUiViewModel(sampleSummary());

  assert.deepEqual(model.period, {
    start: '2026-09-01T00:00:00.000Z',
    end: '2026-09-08T00:00:00.000Z'
  });
  assert.deepEqual(model.comparisonPeriod, {
    start: '2026-08-25T00:00:00.000Z',
    end: '2026-09-01T00:00:00.000Z'
  });
  assert.deepEqual(model.cards.map((card) => card.key), [
    'completedOps',
    'checkCents',
    'averageCheckCents',
    'bonusIssued',
    'bonusSpent',
    'activeClients'
  ]);
  assert.equal(dashboardUiViewModelContract.syntheticMetricsIncluded, false);
  assert.equal('registeredClients' in dashboardUiViewModelContract.drilldownMetrics, false);
  assert.equal('retention' in dashboardUiViewModelContract.drilldownMetrics, false);
  assert.equal('ltv' in dashboardUiViewModelContract.drilldownMetrics, false);
  assert.equal('churn' in dashboardUiViewModelContract.drilldownMetrics, false);
});

test('keeps backend raw values and exposes deterministic presentation text', () => {
  const model = createDashboardUiViewModel(sampleSummary());
  const completed = model.cards.find((card) => card.key === 'completedOps');
  const checks = model.cards.find((card) => card.key === 'checkCents');

  assert.equal(completed.current, 120);
  assert.equal(completed.previous, 100);
  assert.equal(completed.currentText, '120');
  assert.equal(completed.change.text, '+20%');
  assert.equal(completed.change.direction, 'up');

  assert.equal(checks.current, 2500500);
  assert.match(checks.currentText, /^25[\s\u00a0\u202f]?005,00 ₽$/);
  assert.equal(checks.change.text, '+25%');
});

test('renders positive, negative and flat comparisons without changing values', () => {
  const model = createDashboardUiViewModel(sampleSummary());
  const byKey = Object.fromEntries(model.cards.map((card) => [card.key, card]));

  assert.deepEqual(
    { value: byKey.averageCheckCents.change.value, text: byKey.averageCheckCents.change.text, direction: byKey.averageCheckCents.change.direction },
    { value: 4.2, text: '+4,2%', direction: 'up' }
  );
  assert.deepEqual(
    { value: byKey.bonusSpent.change.value, text: byKey.bonusSpent.change.text, direction: byKey.bonusSpent.change.direction },
    { value: -6.7, text: '−6,7%', direction: 'down' }
  );
  assert.deepEqual(
    { value: byKey.activeClients.change.value, text: byKey.activeClients.change.text, direction: byKey.activeClients.change.direction },
    { value: 0, text: '0%', direction: 'flat' }
  );
});

test('does not fabricate percentage change when previous period is zero', () => {
  const summary = sampleSummary();
  summary.metrics.completedOps = {
    current: 10,
    previous: 0,
    changePercent: unavailable('previous_period_zero')
  };

  const card = createDashboardUiViewModel(summary).cards[0];
  assert.equal(card.change.status, 'not_available');
  assert.equal(card.change.value, null);
  assert.equal(card.change.text, 'Нет базы сравнения');
  assert.equal(card.change.direction, 'unavailable');
});

test('keeps unavailable average check unavailable instead of coercing it to zero', () => {
  const summary = sampleSummary();
  summary.metrics.averageCheckCents = {
    current: null,
    previous: 20000,
    changePercent: unavailable('current_period_no_completed_ops')
  };

  const card = createDashboardUiViewModel(summary).cards.find((item) => item.key === 'averageCheckCents');
  assert.equal(card.current, null);
  assert.equal(card.currentText, 'Недоступно');
  assert.equal(card.change.text, 'В текущем периоде нет операций');
});

test('exposes drill-down only where the backend has an exact supported metric', () => {
  const cards = createDashboardUiViewModel(sampleSummary()).cards;
  const mappings = Object.fromEntries(cards.map((card) => [card.key, card.drilldownMetric]));

  assert.deepEqual(mappings, {
    completedOps: 'completed_ops',
    checkCents: 'check_cents',
    averageCheckCents: null,
    bonusIssued: 'bonus_issued',
    bonusSpent: 'bonus_spent',
    activeClients: 'active_clients'
  });
  assert.equal(cards.find((card) => card.key === 'averageCheckCents').interactive, false);
  assert.equal(cards.filter((card) => card.interactive).length, 5);
});

test('fails closed on unsafe or malformed business values', () => {
  const unsafe = sampleSummary();
  unsafe.metrics.checkCents.current = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => createDashboardUiViewModel(unsafe), /safe non-negative integer/);

  const negative = sampleSummary();
  negative.metrics.activeClients.current = -1;
  assert.throws(() => createDashboardUiViewModel(negative), /safe non-negative integer/);

  const fabricatedUnavailable = sampleSummary();
  fabricatedUnavailable.metrics.completedOps.changePercent = {
    value: 100,
    status: 'not_available',
    reason: 'previous_period_zero'
  };
  assert.throws(() => createDashboardUiViewModel(fabricatedUnavailable), /must be null when unavailable/);

  const unknownReason = sampleSummary();
  unknownReason.metrics.completedOps.changePercent = unavailable('unknown_reason');
  assert.throws(() => createDashboardUiViewModel(unknownReason), /reason is unsupported/);
});

test('remains an unmounted presentation layer with no production wiring', () => {
  assert.deepEqual(
    {
      presentationOnly: dashboardUiViewModelContract.presentationOnly,
      domMountEnabled: dashboardUiViewModelContract.domMountEnabled,
      networkRequestsEnabled: dashboardUiViewModelContract.networkRequestsEnabled,
      productionWiringEnabled: dashboardUiViewModelContract.productionWiringEnabled,
      unavailableValuesCoercedToZero: dashboardUiViewModelContract.unavailableValuesCoercedToZero
    },
    {
      presentationOnly: true,
      domMountEnabled: false,
      networkRequestsEnabled: false,
      productionWiringEnabled: false,
      unavailableValuesCoercedToZero: false
    }
  );
});
