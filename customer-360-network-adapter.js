function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

function requireIdentifier(value, name, maxLength = 120) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new TypeError(`${name} must be a string or number`);
  }
  const normalized = String(value).trim();
  if (!normalized) throw new TypeError(`${name} must be non-empty`);
  if (normalized.length > maxLength) throw new RangeError(`${name} is too long`);
  return normalized;
}

function optionalIdentifier(value, name) {
  if (value === null || value === undefined || value === '') return null;
  return requireIdentifier(value, name);
}

function requirePagination(value = {}, prefix = '') {
  const limit = value.limit ?? 25;
  const offset = value.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError(`${prefix}limit must be a safe integer between 1 and 100`);
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError(`${prefix}offset must be a safe non-negative integer`);
  }
  return Object.freeze({ limit, offset });
}

function requireBasePath(value) {
  if (typeof value !== 'string') throw new TypeError('basePath must be a string');
  const normalized = value.trim().replace(/\/+$/u, '');
  if (!normalized.startsWith('/') || normalized.startsWith('//')) {
    throw new TypeError('basePath must be a same-origin absolute path');
  }
  return normalized;
}

async function readJsonResponse(response) {
  if (!response || typeof response.ok !== 'boolean' || typeof response.json !== 'function') {
    throw new TypeError('fetch response must expose ok and json()');
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw Object.assign(new Error('Customer 360 returned invalid JSON'), {
      code: 'customer_360_invalid_json',
      statusCode: Number.isInteger(response.status) ? response.status : 502
    });
  }

  if (!response.ok || payload?.ok !== true) {
    const statusCode = Number.isInteger(response.status) ? response.status : 502;
    const message = typeof payload?.error === 'string' && payload.error.trim()
      ? payload.error.trim()
      : `Customer 360 request failed with status ${statusCode}`;
    throw Object.assign(new Error(message), {
      code: typeof payload?.code === 'string' && payload.code.trim()
        ? payload.code.trim()
        : 'customer_360_request_failed',
      statusCode
    });
  }

  if (!payload.customer || typeof payload.customer !== 'object' || Array.isArray(payload.customer)) {
    throw Object.assign(new Error('Customer 360 card is missing'), {
      code: 'customer_360_card_missing',
      statusCode: 502
    });
  }
  return payload.customer;
}

export function createCustomer360NetworkAdapter({
  tenantId,
  customerId,
  locationId = null,
  fetchImpl = globalThis.fetch,
  basePath = '/api/spaceverse'
} = {}) {
  const scopedTenantId = requireIdentifier(tenantId, 'tenantId');
  const scopedCustomerId = requireIdentifier(customerId, 'customerId', 40);
  const scopedLocationId = optionalIdentifier(locationId, 'locationId');
  const request = requireFunction(fetchImpl, 'fetchImpl');
  const apiBasePath = requireBasePath(basePath);
  const customerPath = `${apiBasePath}/tenants/${encodeURIComponent(scopedTenantId)}/customers/${encodeURIComponent(scopedCustomerId)}`;

  async function loadCustomerCard({ timeline = {}, metadata = {} } = {}) {
    const timelinePage = requirePagination(timeline);
    const metadataPage = requirePagination(metadata, 'metadata ');
    const params = new URLSearchParams();
    params.set('limit', String(timelinePage.limit));
    params.set('offset', String(timelinePage.offset));
    params.set('metadataLimit', String(metadataPage.limit));
    params.set('metadataOffset', String(metadataPage.offset));
    if (scopedLocationId) params.set('locationId', scopedLocationId);

    const response = await request(`${customerPath}?${params.toString()}`, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
    return readJsonResponse(response);
  }

  return Object.freeze({ loadCustomerCard });
}

export const customer360NetworkAdapterContract = Object.freeze({
  readOnly: true,
  sameOriginOnly: true,
  credentials: 'same-origin',
  maxPageSize: 100,
  browserScopeIsRequestOnly: true,
  rawResponseExposed: false,
  dependenciesAdded: false,
  environmentVariablesAdded: false,
  productionNavigationWiring: false
});
