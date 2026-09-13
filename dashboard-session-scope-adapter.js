import { DASHBOARD_SESSION_SCOPE_ROUTE } from './dashboard-session-scope-endpoint.js';

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

async function parseJsonResponse(response) {
  if (!response || typeof response.json !== 'function') {
    throw new TypeError('session scope response must expose json()');
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Dashboard session scope returned invalid JSON');
  }
  if (!response.ok) {
    const code = typeof payload?.error === 'string' && payload.error.trim()
      ? payload.error.trim()
      : 'session_scope_request_failed';
    const error = new Error(`Dashboard session scope unavailable: ${code}`);
    error.code = code;
    error.status = Number(response.status) || 0;
    throw error;
  }
  if (!payload || payload.ok !== true || !payload.scope || typeof payload.scope !== 'object') {
    throw new Error('Dashboard session scope response is malformed');
  }
  return payload.scope;
}

/**
 * Read-only browser resolver for Dashboard page composition.
 *
 * The endpoint is fixed and same-origin; callers cannot supply tenant/location
 * identifiers. The returned server-authorized scope is normalized before it can
 * reach the Dashboard network adapter.
 */
export function createDashboardSessionScopeAdapter({
  fetchImpl = globalThis.fetch
} = {}) {
  const request = requireFunction(fetchImpl, 'fetchImpl');

  return async function resolveSessionScope() {
    const response = await request(DASHBOARD_SESSION_SCOPE_ROUTE, {
      method: 'GET',
      credentials: 'same-origin',
      headers: Object.freeze({ Accept: 'application/json' })
    });
    const scope = await parseJsonResponse(response);
    return Object.freeze({
      tenantId: requireIdentifier(scope.tenantId, 'session tenantId'),
      locationId: optionalIdentifier(scope.locationId, 'session locationId')
    });
  };
}

export const dashboardSessionScopeAdapterContract = Object.freeze({
  route: DASHBOARD_SESSION_SCOPE_ROUTE,
  method: 'GET',
  credentials: 'same-origin',
  tenantInputAccepted: false,
  locationInputAccepted: false,
  readOnly: true,
  autoWiring: false,
  productionNavigationWiring: false,
  externalDependenciesAdded: false
});
