const METRIC_DEFINITIONS = Object.freeze([
  Object.freeze({ key: 'completedOps', label: 'Завершённые операции', kind: 'integer', unit: 'операций', drilldownMetric: 'completed_ops' }),
  Object.freeze({ key: 'checkCents', label: 'Сумма чеков', kind: 'money', unit: '₽', drilldownMetric: 'check_cents' }),
  Object.freeze({ key: 'averageCheckCents', label: 'Средний чек', kind: 'money', unit: '₽', drilldownMetric: null }),
  Object.freeze({ key: 'bonusIssued', label: 'Начислено бонусов', kind: 'integer', unit: 'бонусов', drilldownMetric: 'bonus_issued' }),
  Object.freeze({ key: 'bonusSpent', label: 'Списано бонусов', kind: 'integer', unit: 'бонусов', drilldownMetric: 'bonus_spent' }),
  Object.freeze({ key: 'activeClients', label: 'Активные клиенты', kind: 'integer', unit: 'клиентов', drilldownMetric: 'active_clients' })
]);

const UNAVAILABLE_REASON_LABELS = Object.freeze({
  previous_period_zero: 'Нет базы сравнения',
  previous_period_no_completed_ops: 'В прошлом периоде не было операций',
  current_period_no_completed_ops: 'В текущем периоде нет операций'
});

function assertObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function normalizePeriod(period, name) {
  assertObject(period, name);
  if (typeof period.start !== 'string' || period.start.length === 0) {
    throw new TypeError(`${name}.start must be a non-empty string`);
  }
  if (typeof period.end !== 'string' || period.end.length === 0) {
    throw new TypeError(`${name}.end must be a non-empty string`);
  }
  return Object.freeze({ start: period.start, end: period.end });
}

function assertSafeNonNegativeInteger(value, name, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a safe non-negative integer${nullable ? ' or null' : ''}`);
  }
  return value;
}

function normalizeChange(change, name) {
  assertObject(change, name);

  if (change.status === 'available') {
    if (typeof change.value !== 'number' || !Number.isFinite(change.value)) {
      throw new RangeError(`${name}.value must be a finite number when available`);
    }
    if (change.reason !== null) {
      throw new TypeError(`${name}.reason must be null when available`);
    }
    return Object.freeze({ value: change.value, status: 'available', reason: null });
  }

  if (change.status === 'not_available') {
    if (change.value !== null) {
      throw new TypeError(`${name}.value must be null when unavailable`);
    }
    if (typeof change.reason !== 'string' || !UNAVAILABLE_REASON_LABELS[change.reason]) {
      throw new RangeError(`${name}.reason is unsupported`);
    }
    return Object.freeze({ value: null, status: 'not_available', reason: change.reason });
  }

  throw new RangeError(`${name}.status is unsupported`);
}

function normalizeMetric(metric, name, { nullable = false } = {}) {
  assertObject(metric, name);
  return Object.freeze({
    current: assertSafeNonNegativeInteger(metric.current, `${name}.current`, { nullable }),
    previous: assertSafeNonNegativeInteger(metric.previous, `${name}.previous`, { nullable }),
    changePercent: normalizeChange(metric.changePercent, `${name}.changePercent`)
  });
}

function formatInteger(value) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}

function formatMoneyCents(value) {
  return `${new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value / 100)} ₽`;
}

function formatMetricValue(value, kind) {
  if (value === null) return 'Недоступно';
  if (kind === 'money') return formatMoneyCents(value);
  return formatInteger(value);
}

function createChangeView(change) {
  if (change.status === 'not_available') {
    return Object.freeze({
      status: 'not_available',
      direction: 'unavailable',
      value: null,
      text: UNAVAILABLE_REASON_LABELS[change.reason],
      reason: change.reason
    });
  }

  const direction = change.value > 0 ? 'up' : change.value < 0 ? 'down' : 'flat';
  const prefix = change.value > 0 ? '+' : change.value < 0 ? '−' : '';
  const absoluteValue = Math.abs(change.value);
  const formatted = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: Number.isInteger(absoluteValue) ? 0 : 1,
    maximumFractionDigits: 1
  }).format(absoluteValue);

  return Object.freeze({
    status: 'available',
    direction,
    value: change.value,
    text: `${prefix}${formatted}%`,
    reason: null
  });
}

/**
 * Presentation-only Dashboard model.
 *
 * No DOM mutation, network request, synthetic KPI or fallback-to-zero happens
 * here. Missing/unsafe backend values fail closed instead of being displayed
 * as plausible business data.
 */
export function createDashboardUiViewModel(summary) {
  assertObject(summary, 'summary');
  const period = normalizePeriod(summary.period, 'summary.period');
  const comparisonPeriod = normalizePeriod(summary.comparisonPeriod, 'summary.comparisonPeriod');
  const metrics = assertObject(summary.metrics, 'summary.metrics');

  const cards = METRIC_DEFINITIONS.map((definition) => {
    const nullable = definition.key === 'averageCheckCents';
    const metric = normalizeMetric(metrics[definition.key], `summary.metrics.${definition.key}`, { nullable });

    return Object.freeze({
      key: definition.key,
      label: definition.label,
      unit: definition.unit,
      current: metric.current,
      previous: metric.previous,
      currentText: formatMetricValue(metric.current, definition.kind),
      previousText: formatMetricValue(metric.previous, definition.kind),
      change: createChangeView(metric.changePercent),
      drilldownMetric: definition.drilldownMetric,
      interactive: definition.drilldownMetric !== null
    });
  });

  return Object.freeze({
    period,
    comparisonPeriod,
    cards: Object.freeze(cards)
  });
}

export const dashboardUiViewModelContract = Object.freeze({
  presentationOnly: true,
  domMountEnabled: false,
  networkRequestsEnabled: false,
  productionWiringEnabled: false,
  syntheticMetricsIncluded: false,
  unavailableValuesCoercedToZero: false,
  metrics: Object.freeze(METRIC_DEFINITIONS.map(({ key }) => key)),
  drilldownMetrics: Object.freeze({
    completedOps: 'completed_ops',
    checkCents: 'check_cents',
    averageCheckCents: null,
    bonusIssued: 'bonus_issued',
    bonusSpent: 'bonus_spent',
    activeClients: 'active_clients'
  })
});
