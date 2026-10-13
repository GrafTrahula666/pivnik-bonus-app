function normalizeScopeId(value, name) {
  if (value === null || value === undefined || value === '') {
    throw new TypeError(`${name} is required`);
  }
  const normalized = String(value).trim();
  if (!normalized) throw new TypeError(`${name} must be a non-empty identifier`);
  return normalized;
}

function normalizeOptionalScopeId(value, name) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim();
  if (!normalized) throw new TypeError(`${name} must be a non-empty identifier when provided`);
  return normalized;
}

function normalizeInstant(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${name} is required`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new TypeError(`${name} must be a valid timestamp`);
  return parsed;
}

function buildPeriod({ start, end, name }) {
  const startAt = normalizeInstant(start, `${name}.start`);
  const endAt = normalizeInstant(end, `${name}.end`);
  if (endAt <= startAt) throw new RangeError(`${name}.end must be after ${name}.start`);
  return Object.freeze({ start: startAt.toISOString(), end: endAt.toISOString() });
}

function buildPreviousPeriod(current) {
  const startMs = new Date(current.start).getTime();
  const endMs = new Date(current.end).getTime();
  const durationMs = endMs - startMs;
  return Object.freeze({
    start: new Date(startMs - durationMs).toISOString(),
    end: current.start
  });
}

function buildScopedPeriodComparisonQuery({ tenantId, locationId = null, start, end }) {
  const normalizedTenantId = normalizeScopeId(tenantId, 'tenantId');
  const normalizedLocationId = normalizeOptionalScopeId(locationId, 'locationId');
  const current = buildPeriod({ start, end, name: 'period' });
  const previous = buildPreviousPeriod(current);

  const params = [normalizedTenantId];
  let scopePredicate = 'tenant_id = $1';
  if (normalizedLocationId !== null) {
    params.push(normalizedLocationId);
    scopePredicate += ` AND location_id = $${params.length}`;
  }

  params.push(previous.start, current.start, current.end);
  const previousStartIndex = params.length - 2;
  const currentStartIndex = params.length - 1;
  const currentEndIndex = params.length;

  const sql = `
    SELECT
      COUNT(*) FILTER (
        WHERE status = 'completed'
          AND created_at >= $${currentStartIndex}
          AND created_at < $${currentEndIndex}
      )::int AS current_completed_ops,
      COALESCE(SUM(check_amount_cents) FILTER (
        WHERE status = 'completed'
          AND created_at >= $${currentStartIndex}
          AND created_at < $${currentEndIndex}
      ), 0)::bigint AS current_check_cents,
      COALESCE(SUM(bonus_earned) FILTER (
        WHERE status = 'completed'
          AND created_at >= $${currentStartIndex}
          AND created_at < $${currentEndIndex}
      ), 0)::bigint AS current_bonus_issued,
      COALESCE(SUM(bonus_spent) FILTER (
        WHERE status = 'completed'
          AND created_at >= $${currentStartIndex}
          AND created_at < $${currentEndIndex}
      ), 0)::bigint AS current_bonus_spent,
      COUNT(DISTINCT client_id) FILTER (
        WHERE status = 'completed'
          AND created_at >= $${currentStartIndex}
          AND created_at < $${currentEndIndex}
      )::int AS current_active_clients,
      COUNT(*) FILTER (
        WHERE status = 'completed'
          AND created_at >= $${previousStartIndex}
          AND created_at < $${currentStartIndex}
      )::int AS previous_completed_ops,
      COALESCE(SUM(check_amount_cents) FILTER (
        WHERE status = 'completed'
          AND created_at >= $${previousStartIndex}
          AND created_at < $${currentStartIndex}
      ), 0)::bigint AS previous_check_cents,
      COALESCE(SUM(bonus_earned) FILTER (
        WHERE status = 'completed'
          AND created_at >= $${previousStartIndex}
          AND created_at < $${currentStartIndex}
      ), 0)::bigint AS previous_bonus_issued,
      COALESCE(SUM(bonus_spent) FILTER (
        WHERE status = 'completed'
          AND created_at >= $${previousStartIndex}
          AND created_at < $${currentStartIndex}
      ), 0)::bigint AS previous_bonus_spent,
      COUNT(DISTINCT client_id) FILTER (
        WHERE status = 'completed'
          AND created_at >= $${previousStartIndex}
          AND created_at < $${currentStartIndex}
      )::int AS previous_active_clients
    FROM transactions
    WHERE ${scopePredicate}
  `;

  return Object.freeze({
    sql,
    params: Object.freeze(params),
    current,
    previous
  });
}

/**
 * Read-only tenant/location-scoped Dashboard comparison read model.
 *
 * It compares an explicit [start, end) period with the immediately preceding
 * period of exactly the same duration. No server-local CURRENT_DATE semantics
 * are used, so callers can define business reporting boundaries explicitly.
 *
 * This remains migration-gated and is not wired into production while
 * transaction tenant/location attribution is deliberately disabled.
 */
export function createSqlDashboardPeriodSummaryRepository({ query }) {
  if (typeof query !== 'function') throw new TypeError('query must be a function');

  return async function loadDashboardPeriodSummary(scope) {
    const plan = buildScopedPeriodComparisonQuery(scope || {});
    const result = await query(plan.sql, [...plan.params]);
    if (!result || !Array.isArray(result.rows)) {
      throw new TypeError('dashboard period query must resolve to an object with rows[]');
    }
    if (result.rows.length !== 1) {
      throw new TypeError('dashboard period query must return exactly one aggregate row');
    }

    return Object.freeze({
      period: plan.current,
      comparisonPeriod: plan.previous,
      metrics: Object.freeze({ ...result.rows[0] })
    });
  };
}

export const dashboardPeriodSummaryRepositoryContract = Object.freeze({
  sourceTable: 'transactions',
  requiredScopeColumns: Object.freeze(['tenant_id', 'location_id']),
  periodSemantics: '[start,end)',
  comparisonSemantics: 'immediately-preceding-equal-duration',
  metrics: Object.freeze([
    'completed_ops',
    'check_cents',
    'bonus_issued',
    'bonus_spent',
    'active_clients'
  ]),
  activeClientsDefinition: 'distinct client_id with completed transaction in period',
  registeredClientsIncluded: false,
  productionWiringEnabled: false,
  buildScopedPeriodComparisonQuery
});
