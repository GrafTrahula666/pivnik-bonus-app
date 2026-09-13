const SUPPORTED_METRICS = Object.freeze([
  'completed_ops',
  'check_cents',
  'bonus_issued',
  'bonus_spent',
  'active_clients'
]);

function normalizeRequiredId(value, name) {
  if (value === null || value === undefined || value === '') {
    throw Object.assign(new TypeError(`${name} is required`), { statusCode: 400 });
  }
  const normalized = String(value).trim();
  if (!normalized) {
    throw Object.assign(new TypeError(`${name} must be a non-empty identifier`), { statusCode: 400 });
  }
  return normalized;
}

function normalizeOptionalId(value, name) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim();
  if (!normalized) {
    throw Object.assign(new TypeError(`${name} must be a non-empty identifier when provided`), { statusCode: 400 });
  }
  return normalized;
}

function normalizeInstant(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw Object.assign(new TypeError(`${name} is required`), { statusCode: 400 });
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw Object.assign(new TypeError(`${name} must be a valid timestamp`), { statusCode: 400 });
  }
  return parsed.toISOString();
}

function normalizeMetric(value) {
  const metric = String(value ?? '').trim();
  if (!SUPPORTED_METRICS.includes(metric)) {
    throw Object.assign(new TypeError('metric is not supported'), { statusCode: 400 });
  }
  return metric;
}

function boundedPage({ limit = 50, offset = 0 } = {}) {
  const normalizedLimit = Number(limit);
  const normalizedOffset = Number(offset);
  if (!Number.isSafeInteger(normalizedLimit) || normalizedLimit < 1 || normalizedLimit > 100) {
    throw Object.assign(new TypeError('limit must be an integer between 1 and 100'), { statusCode: 400 });
  }
  if (!Number.isSafeInteger(normalizedOffset) || normalizedOffset < 0 || normalizedOffset > 1000000) {
    throw Object.assign(new TypeError('offset must be an integer between 0 and 1000000'), { statusCode: 400 });
  }
  return Object.freeze({ limit: normalizedLimit, offset: normalizedOffset });
}

function buildScope({ tenantId, locationId = null, start, end }) {
  const normalizedTenantId = normalizeRequiredId(tenantId, 'tenantId');
  const normalizedLocationId = normalizeOptionalId(locationId, 'locationId');
  const startAt = normalizeInstant(start, 'period.start');
  const endAt = normalizeInstant(end, 'period.end');
  if (new Date(endAt) <= new Date(startAt)) {
    throw Object.assign(new RangeError('period.end must be after period.start'), { statusCode: 400 });
  }

  const params = [normalizedTenantId];
  const clauses = ['t.tenant_id = $1'];
  if (normalizedLocationId !== null) {
    params.push(normalizedLocationId);
    clauses.push(`t.location_id = $${params.length}`);
  }
  params.push(startAt, endAt);
  clauses.push(`t.created_at >= $${params.length - 1}`);
  clauses.push(`t.created_at < $${params.length}`);
  clauses.push("t.status = 'completed'");

  return Object.freeze({
    params: Object.freeze(params),
    predicate: clauses.join(' AND '),
    period: Object.freeze({ start: startAt, end: endAt })
  });
}

function buildTransactionQuery({ metric, scope, limit, offset }) {
  const params = [...scope.params, limit + 1, offset];
  return Object.freeze({
    sql: `SELECT
      t.id, t.client_id, t.location_id, t.mode,
      t.check_amount_cents, t.cash_paid_cents,
      t.bonus_earned, t.bonus_spent,
      t.reason, t.reward_code, t.created_at, t.completed_at
    FROM transactions t
    WHERE ${scope.predicate}
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT $${scope.params.length + 1} OFFSET $${scope.params.length + 2}`,
    params,
    rowKind: 'transaction',
    metric
  });
}

function buildActiveClientsQuery({ metric, scope, limit, offset }) {
  const params = [...scope.params, limit + 1, offset];
  return Object.freeze({
    sql: `SELECT
      t.client_id,
      COUNT(*)::int AS completed_ops,
      COALESCE(SUM(t.check_amount_cents), 0)::bigint AS check_cents,
      COALESCE(SUM(t.bonus_earned), 0)::bigint AS bonus_issued,
      COALESCE(SUM(t.bonus_spent), 0)::bigint AS bonus_spent,
      MAX(t.created_at) AS last_activity_at
    FROM transactions t
    WHERE ${scope.predicate}
    GROUP BY t.client_id
    ORDER BY MAX(t.created_at) DESC, t.client_id DESC
    LIMIT $${scope.params.length + 1} OFFSET $${scope.params.length + 2}`,
    params,
    rowKind: 'client',
    metric
  });
}

function buildDrilldownQuery(options = {}) {
  const metric = normalizeMetric(options.metric);
  const scope = buildScope(options);
  const page = boundedPage(options);
  return metric === 'active_clients'
    ? buildActiveClientsQuery({ metric, scope, ...page })
    : buildTransactionQuery({ metric, scope, ...page });
}

/**
 * Read-only evidence model behind Dashboard KPI cards.
 *
 * For transaction-derived totals it returns the concrete completed transactions
 * inside the selected scope/period. For active_clients it returns one grouped
 * row per distinct client, matching the Dashboard definition exactly.
 */
export function createSqlDashboardKpiDrilldownRepository({ query }) {
  if (typeof query !== 'function') throw new TypeError('query must be a function');

  return async function loadDashboardKpiDrilldown(options = {}) {
    const plan = buildDrilldownQuery(options);
    const result = await query(plan.sql, [...plan.params]);
    if (!result || !Array.isArray(result.rows)) {
      throw new TypeError('dashboard drilldown query must resolve to an object with rows[]');
    }

    const limit = Number(options.limit ?? 50);
    const offset = Number(options.offset ?? 0);
    return Object.freeze({
      metric: plan.metric,
      rowKind: plan.rowKind,
      period: buildScope(options).period,
      rows: Object.freeze(result.rows.slice(0, limit).map((row) => Object.freeze({ ...row }))),
      hasMore: result.rows.length > limit,
      limit,
      offset
    });
  };
}

export const dashboardKpiDrilldownRepositoryContract = Object.freeze({
  sourceTable: 'transactions',
  supportedMetrics: SUPPORTED_METRICS,
  requiredScopeColumns: Object.freeze(['tenant_id', 'location_id']),
  periodSemantics: '[start,end)',
  completedTransactionsOnly: true,
  activeClientsDefinition: 'one row per distinct client_id with completed transaction in period',
  maxPageSize: 100,
  readOnly: true,
  productionWiringEnabled: false,
  externalDependenciesAdded: false,
  buildDrilldownQuery
});
