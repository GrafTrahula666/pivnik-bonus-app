function toSafeNonNegativeInteger(value, name) {
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  if (Number.isSafeInteger(value) && value >= 0) return value;
  throw new RangeError(`${name} must be a safe non-negative integer`);
}

function normalizePeriod(period, name) {
  if (!period || typeof period !== 'object') throw new TypeError(`${name} is required`);
  if (typeof period.start !== 'string' || typeof period.end !== 'string') {
    throw new TypeError(`${name} must contain start and end timestamps`);
  }
  return Object.freeze({ start: period.start, end: period.end });
}

function percentageChange(current, previous) {
  if (previous === 0) {
    return Object.freeze({
      value: null,
      status: 'not_available',
      reason: 'previous_period_zero'
    });
  }

  const value = Math.round((((current - previous) / previous) * 100) * 10) / 10;
  if (!Number.isFinite(value)) {
    throw new RangeError('percentage change must be finite');
  }

  return Object.freeze({ value, status: 'available', reason: null });
}

function averageCents(totalCents, completedOps) {
  if (completedOps === 0) return null;
  return Math.round(totalCents / completedOps);
}

function comparisonForNullableAverage(current, previous) {
  if (previous === null) {
    return Object.freeze({
      value: null,
      status: 'not_available',
      reason: 'previous_period_no_completed_ops'
    });
  }
  if (current === null) {
    return Object.freeze({
      value: null,
      status: 'not_available',
      reason: 'current_period_no_completed_ops'
    });
  }
  return percentageChange(current, previous);
}

function metric(current, previous) {
  return Object.freeze({
    current,
    previous,
    changePercent: percentageChange(current, previous)
  });
}

function nullableMetric(current, previous) {
  return Object.freeze({
    current,
    previous,
    changePercent: comparisonForNullableAverage(current, previous)
  });
}

function normalizeRawMetrics(raw) {
  if (!raw || typeof raw !== 'object') throw new TypeError('metrics must be an object');

  return Object.freeze({
    currentCompletedOps: toSafeNonNegativeInteger(raw.current_completed_ops, 'current_completed_ops'),
    currentCheckCents: toSafeNonNegativeInteger(raw.current_check_cents, 'current_check_cents'),
    currentBonusIssued: toSafeNonNegativeInteger(raw.current_bonus_issued, 'current_bonus_issued'),
    currentBonusSpent: toSafeNonNegativeInteger(raw.current_bonus_spent, 'current_bonus_spent'),
    currentActiveClients: toSafeNonNegativeInteger(raw.current_active_clients, 'current_active_clients'),
    previousCompletedOps: toSafeNonNegativeInteger(raw.previous_completed_ops, 'previous_completed_ops'),
    previousCheckCents: toSafeNonNegativeInteger(raw.previous_check_cents, 'previous_check_cents'),
    previousBonusIssued: toSafeNonNegativeInteger(raw.previous_bonus_issued, 'previous_bonus_issued'),
    previousBonusSpent: toSafeNonNegativeInteger(raw.previous_bonus_spent, 'previous_bonus_spent'),
    previousActiveClients: toSafeNonNegativeInteger(raw.previous_active_clients, 'previous_active_clients')
  });
}

/**
 * Presentation-safe Dashboard KPI service over the scoped period repository.
 *
 * This layer does not query global user state or invent missing business data.
 * Percentage change is unavailable when the comparison base is zero instead
 * of presenting infinity or a fabricated 100% value.
 */
export function createDashboardPeriodSummaryService({ loadPeriodSummary }) {
  if (typeof loadPeriodSummary !== 'function') {
    throw new TypeError('loadPeriodSummary must be a function');
  }

  return async function getDashboardPeriodSummary(scope) {
    const result = await loadPeriodSummary(scope);
    if (!result || typeof result !== 'object') {
      throw new TypeError('period summary repository must return an object');
    }

    const period = normalizePeriod(result.period, 'period');
    const comparisonPeriod = normalizePeriod(result.comparisonPeriod, 'comparisonPeriod');
    const raw = normalizeRawMetrics(result.metrics);

    const currentAverageCheckCents = averageCents(raw.currentCheckCents, raw.currentCompletedOps);
    const previousAverageCheckCents = averageCents(raw.previousCheckCents, raw.previousCompletedOps);

    return Object.freeze({
      period,
      comparisonPeriod,
      metrics: Object.freeze({
        completedOps: metric(raw.currentCompletedOps, raw.previousCompletedOps),
        checkCents: metric(raw.currentCheckCents, raw.previousCheckCents),
        averageCheckCents: nullableMetric(currentAverageCheckCents, previousAverageCheckCents),
        bonusIssued: metric(raw.currentBonusIssued, raw.previousBonusIssued),
        bonusSpent: metric(raw.currentBonusSpent, raw.previousBonusSpent),
        activeClients: metric(raw.currentActiveClients, raw.previousActiveClients)
      })
    });
  };
}

export const dashboardPeriodSummaryServiceContract = Object.freeze({
  formulas: Object.freeze({
    completedOps: 'count of completed transactions in period',
    checkCents: 'sum of check_amount_cents for completed transactions in period',
    averageCheckCents: 'rounded checkCents / completedOps; unavailable when completedOps = 0',
    bonusIssued: 'sum of bonus_earned for completed transactions in period',
    bonusSpent: 'sum of bonus_spent for completed transactions in period',
    activeClients: 'distinct client_id with completed transaction in period',
    changePercent: 'round(((current - previous) / previous) * 100, 1); unavailable when previous = 0'
  }),
  zeroComparisonBehavior: 'not_available:previous_period_zero',
  registeredClientsIncluded: false,
  syntheticMetricsIncluded: false,
  productionWiringEnabled: false
});
