const SUPPORTED_DRILLDOWN_METRICS = Object.freeze([
  'completed_ops',
  'check_cents',
  'bonus_issued',
  'bonus_spent',
  'active_clients'
]);

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

function requireIdentifier(value, name) {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`);
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${name} must be non-empty`);
  if (normalized.length > 120) throw new RangeError(`${name} is too long`);
  return normalized;
}

function optionalIdentifier(value, name) {
  if (value === null || value === undefined || value === '') return null;
  return requireIdentifier(value, name);
}

function requireInstantText(value, name) {
  const normalized = requireIdentifier(value, name);
  const timestamp = new Date(normalized).getTime();
  if (!Number.isFinite(timestamp)) throw new TypeError(`${name} must be a valid timestamp`);
  return normalized;
}

function requireBasePath(value) {
  if (typeof value !== 'string') throw new TypeError('basePath must be a string');
  const normalized = value.trim().replace(/\/+$/u, '');
  if (!normalized.startsWith('/') || normalized.startsWith('//')) {
    throw new TypeError('basePath must be a same-origin absolute path');
  }
  return normalized;
}

function requirePagination({ limit = 50, offset = 0 } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError('limit must be a safe integer between 1 and 100');
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError('offset must be a safe non-negative integer');
  }
  return Object.freeze({ limit, offset });
}

async function readJsonResponse(response) {
  if (!response || typeof response.json !== 'function' || typeof response.ok !== 'boolean') {
    throw new TypeError('fetch response must expose ok and json()');
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw Object.assign(new Error('Dashboard returned invalid JSON'), {
      code: 'dashboard_invalid_json',
      statusCode: Number.isInteger(response.status) ? response.status : 502
    });
  }

  if (!response.ok || payload?.ok !== true) {
    const statusCode = Number.isInteger(response.status) ? response.status : 502;
    const message = typeof payload?.error === 'string' && payload.error.trim()
      ? payload.error.trim()
      : `Dashboard request failed with status ${statusCode}`;
    throw Object.assign(new Error(message), {
      code: typeof payload?.code === 'string' ? payload.code : 'dashboard_request_failed',
      statusCode
    });
  }

  return payload;
}

export function createDashboardNetworkAdapter({
  tenantId,
  locationId = null,
  start,
  end,
  fetchImpl = globalThis.fetch,
  basePath = '/api/spaceverse'
} = {}) {
  const scopedTenantId = requireIdentifier(tenantId, 'tenantId');
  const scopedLocationId = optionalIdentifier(locationId, 'locationId');
  const periodStart = requireInstantText(start, 'start');
  const periodEnd = requireInstantText(end, 'end');
  const startMs = new Date(periodStart).getTime();
  const endMs = new Date(periodEnd).getTime();
  if (startMs >= endMs) throw new RangeError('start must be before end');
  const request = requireFunction(fetchImpl, 'fetchImpl');
  const apiBasePath = requireBasePath(basePath);
  const tenantPath = `${apiBasePath}/tenants/${encodeURIComponent(scopedTenantId)}/dashboard`;

  function commonParams() {
    const params = new URLSearchParams();
    params.set('start', periodStart);
    params.set('end', periodEnd);
    if (scopedLocationId) params.set('locationId', scopedLocationId);
    return params;
  }

  async function loadSummary() {
    const params = commonParams();
    const response = await request(`${tenantPath}/period-summary?${params.toString()}`, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
    const payload = await readJsonResponse(response);
    if (!payload.summary || typeof payload.summary !== 'object') {
      throw Object.assign(new Error('Dashboard summary is missing'), {
        code: 'dashboard_summary_missing',
        statusCode: 502
      });
    }
    return payload.summary;
  }

  async function loadDrilldown(metric, pagination = {}) {
    if (!SUPPORTED_DRILLDOWN_METRICS.includes(metric)) {
      throw new RangeError('unsupported Dashboard drilldown metric');
    }
    const { limit, offset } = requirePagination(pagination);
    const params = commonParams();
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    const response = await request(`${tenantPath}/drilldown/${encodeURIComponent(metric)}?${params.toString()}`, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
    const payload = await readJsonResponse(response);
    if (!payload.drilldown || typeof payload.drilldown !== 'object') {
      throw Object.assign(new Error('Dashboard drilldown is missing'), {
        code: 'dashboard_drilldown_missing',
        statusCode: 502
      });
    }
    return payload;
  }

  return Object.freeze({ loadSummary, loadDrilldown });
}

export const dashboardNetworkAdapterContract = Object.freeze({
  readOnly: true,
  sameOriginOnly: true,
  credentials: 'same-origin',
  maxPageSize: 100,
  supportedDrilldownMetrics: SUPPORTED_DRILLDOWN_METRICS,
  dependenciesAdded: false,
  environmentVariablesAdded: false,
  productionNavigationWiring: false
});
