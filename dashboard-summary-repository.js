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

const BASE_SELECT = `
  SELECT
    COALESCE(SUM(bonus_earned) FILTER (WHERE status = 'completed'), 0)::bigint AS issued,
    COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)::int AS today_ops,
    COALESCE(SUM(check_amount_cents) FILTER (
      WHERE status = 'completed' AND created_at::date = CURRENT_DATE
    ), 0)::bigint AS today_check_cents,
    COUNT(*) FILTER (WHERE is_suspicious = TRUE AND status = 'completed')::int AS suspicious_ops,
    COUNT(*) FILTER (
      WHERE status = 'cancelled' AND cancelled_at::date = CURRENT_DATE
    )::int AS cancelled_today
  FROM transactions
`;

function buildScopedSummaryQuery({ tenantId, locationId = null }) {
  const normalizedTenantId = normalizeScopeId(tenantId, 'tenantId');
  const normalizedLocationId = normalizeOptionalScopeId(locationId, 'locationId');
  const params = [normalizedTenantId];
  let sql = `${BASE_SELECT}\n  WHERE tenant_id = $1`;

  if (normalizedLocationId !== null) {
    params.push(normalizedLocationId);
    sql += '\n    AND location_id = $2';
  }

  return Object.freeze({ sql: `${sql}\n`, params: Object.freeze(params) });
}

/**
 * Read-only tenant/location-scoped operational Dashboard repository.
 *
 * This contract is intentionally NOT wired into production yet. Current
 * production transactions do not have an approved tenant/location attribution
 * migration, so executing this against today's schema would be incorrect.
 * The repository exists to make the isolation boundary testable before the
 * later additive schema change.
 *
 * Deliberately omitted: total registered clients. There is no approved
 * tenant-attribution source for users yet, so reporting that KPI per tenant
 * would require guessing ownership and could leak/corrupt analytics.
 */
export function createSqlDashboardSummaryRepository({ query }) {
  if (typeof query !== 'function') throw new TypeError('query must be a function');

  return async function loadDashboardSummary(scope) {
    const { sql, params } = buildScopedSummaryQuery(scope || {});
    const result = await query(sql, [...params]);

    if (!result || !Array.isArray(result.rows)) {
      throw new TypeError('dashboard summary query must resolve to an object with rows[]');
    }
    if (result.rows.length !== 1) {
      throw new TypeError('dashboard summary query must return exactly one aggregate row');
    }

    return Object.freeze({ ...result.rows[0] });
  };
}

export const dashboardSummaryRepositoryContract = Object.freeze({
  sourceTable: 'transactions',
  requiredFutureColumns: Object.freeze(['tenant_id', 'location_id']),
  returnedMetrics: Object.freeze([
    'issued',
    'today_ops',
    'today_check_cents',
    'suspicious_ops',
    'cancelled_today'
  ]),
  intentionallyDeferredMetrics: Object.freeze([
    Object.freeze({
      metric: 'clients',
      reason: 'users do not yet have an approved tenant-attribution source'
    })
  ]),
  buildScopedSummaryQuery
});
