const DIRECTORY_ROUTE = '/api/spaceverse/session/dashboard-scopes';
const SELECTION_ROUTE = '/api/spaceverse/session/dashboard-scope/select';
const MAX_IDENTIFIER_LENGTH = 120;
const MAX_DISPLAY_NAME_LENGTH = 200;

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

function requireIdentifier(value, name) {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`);
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${name} must be non-empty`);
  if (normalized.length > MAX_IDENTIFIER_LENGTH) throw new RangeError(`${name} is too long`);
  return normalized;
}

function optionalIdentifier(value, name) {
  if (value === null || value === undefined || value === '') return null;
  return requireIdentifier(value, name);
}

function requireDisplayName(value, name) {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`);
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${name} must be non-empty`);
  if (normalized.length > MAX_DISPLAY_NAME_LENGTH) throw new RangeError(`${name} is too long`);
  return normalized;
}

function normalizeTenant(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('tenant must be an object');
  }
  return Object.freeze({
    tenantId: requireIdentifier(value.tenantId, 'tenantId'),
    displayName: requireDisplayName(value.displayName, 'tenant displayName')
  });
}

function normalizeLocation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('location must be an object');
  }
  return Object.freeze({
    locationId: requireIdentifier(value.locationId, 'locationId'),
    displayName: requireDisplayName(value.displayName, 'location displayName')
  });
}

function normalizeScope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('scope must be an object');
  }
  return Object.freeze({
    tenantId: requireIdentifier(value.tenantId, 'scope tenantId'),
    locationId: optionalIdentifier(value.locationId, 'scope locationId')
  });
}

async function parseJsonResponse(response) {
  if (!response || typeof response !== 'object') throw new TypeError('invalid response');
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error('dashboard_scope_response_invalid');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('dashboard_scope_response_invalid');
  }
  if (!response.ok || body.ok !== true) {
    const code = typeof body.error === 'string' && body.error.trim()
      ? body.error.trim()
      : `dashboard_scope_http_${Number(response.status) || 500}`;
    throw new Error(code);
  }
  return body;
}

export function createDashboardScopeBrowserAdapter({ fetchImpl = globalThis.fetch } = {}) {
  const request = requireFunction(fetchImpl, 'fetchImpl');

  async function loadTenants() {
    const response = await request(DIRECTORY_ROUTE, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
    const body = await parseJsonResponse(response);
    if (!Array.isArray(body.tenants)) throw new Error('dashboard_scope_directory_invalid');
    return Object.freeze(body.tenants.map(normalizeTenant));
  }

  async function loadLocations(tenantId) {
    const normalizedTenantId = requireIdentifier(tenantId, 'tenantId');
    const query = new URLSearchParams({ tenantId: normalizedTenantId });
    const response = await request(`${DIRECTORY_ROUTE}?${query.toString()}`, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
    const body = await parseJsonResponse(response);
    const tenant = normalizeTenant(body.tenant);
    if (tenant.tenantId !== normalizedTenantId) {
      throw new Error('dashboard_scope_directory_mismatch');
    }
    if (!Array.isArray(body.locations)) throw new Error('dashboard_scope_directory_invalid');
    return Object.freeze({
      tenant,
      locations: Object.freeze(body.locations.map(normalizeLocation))
    });
  }

  async function selectScope({ tenantId, locationId = null } = {}) {
    const normalizedTenantId = requireIdentifier(tenantId, 'tenantId');
    const normalizedLocationId = optionalIdentifier(locationId, 'locationId');
    const payload = normalizedLocationId
      ? { tenantId: normalizedTenantId, locationId: normalizedLocationId }
      : { tenantId: normalizedTenantId };

    const response = await request(SELECTION_ROUTE, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const body = await parseJsonResponse(response);
    const scope = normalizeScope(body.scope);
    if (scope.tenantId !== normalizedTenantId || scope.locationId !== normalizedLocationId) {
      throw new Error('dashboard_scope_selection_mismatch');
    }
    return scope;
  }

  return Object.freeze({ loadTenants, loadLocations, selectScope });
}

export const dashboardScopeBrowserAdapterContract = Object.freeze({
  directoryRoute: DIRECTORY_ROUTE,
  selectionRoute: SELECTION_ROUTE,
  credentials: 'same-origin',
  fixedSameOriginRoutes: true,
  directoryReadOnly: true,
  selectionPersistsClientAuthority: false,
  selectedScopeMustMatchServerResponse: true,
  acceptsArbitraryEndpoint: false,
  externalDependenciesAdded: false,
  environmentVariablesAdded: false
});
