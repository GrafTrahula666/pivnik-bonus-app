const DEFAULT_BASE_PATH = '/api/spaceverse/tenants';

const MUTATIONS = Object.freeze({
  addNote: Object.freeze({ suffix: 'notes', valueField: 'note', maxLength: 2000 }),
  addTag: Object.freeze({ suffix: 'tags', valueField: 'tag', maxLength: 80 }),
  removeTag: Object.freeze({ suffix: 'tags/remove', valueField: 'tag', maxLength: 80 }),
  addSegment: Object.freeze({ suffix: 'segments', valueField: 'segment', maxLength: 120 }),
  removeSegment: Object.freeze({ suffix: 'segments/remove', valueField: 'segment', maxLength: 120 })
});

function requireSameOriginPath(value, name) {
  const path = String(value || '').trim();
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) {
    throw new TypeError(`${name} must be a same-origin path`);
  }
  return path.replace(/\/$/, '');
}

function normalizeRequired(value, field, maxLength) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new TypeError(`${field} is required`);
  }
  const normalized = String(value).trim();
  if (normalized.length > maxLength) {
    throw new TypeError(`${field} must not exceed ${maxLength} characters`);
  }
  return normalized;
}

function createHttpError(payload, status) {
  const error = new Error(String(payload?.error || `Customer metadata request failed with HTTP ${status}`));
  error.statusCode = status;
  if (payload?.code) error.code = String(payload.code);
  return error;
}

export function createCustomerMetadataNetworkAdapter({
  tenantId,
  locationId,
  customerId,
  basePath = DEFAULT_BASE_PATH,
  fetchImpl = globalThis.fetch
} = {}) {
  const normalizedTenantId = normalizeRequired(tenantId, 'tenantId', 200);
  const normalizedLocationId = normalizeRequired(locationId, 'locationId', 200);
  const normalizedCustomerId = normalizeRequired(customerId, 'customerId', 200);
  const normalizedBasePath = requireSameOriginPath(basePath, 'basePath');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');

  const customerBase = `${normalizedBasePath}/${encodeURIComponent(normalizedTenantId)}/locations/${encodeURIComponent(normalizedLocationId)}/customers/${encodeURIComponent(normalizedCustomerId)}`;

  async function execute(kind, input = {}) {
    const mutation = MUTATIONS[kind];
    if (!mutation) throw new TypeError(`Unknown customer metadata mutation: ${kind}`);

    const value = normalizeRequired(input[mutation.valueField], mutation.valueField, mutation.maxLength);
    const reason = normalizeRequired(input.reason, 'reason', 500);
    const requestKey = normalizeRequired(input.requestKey, 'requestKey', 200);
    const body = {
      [mutation.valueField]: value,
      reason,
      requestKey
    };

    const response = await fetchImpl(`${customerBase}/${mutation.suffix}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) throw createHttpError(payload, response.status);
    if (payload?.ok !== true) {
      throw Object.assign(new Error('Customer metadata response is malformed'), {
        statusCode: 502,
        code: 'customer_metadata_response_invalid'
      });
    }

    return Object.freeze({
      eventId: payload.eventId ?? null,
      eventType: payload.eventType ?? null,
      value: payload.value ?? null
    });
  }

  return Object.freeze({
    addNote(input) { return execute('addNote', input); },
    addTag(input) { return execute('addTag', input); },
    removeTag(input) { return execute('removeTag', input); },
    addSegment(input) { return execute('addSegment', input); },
    removeSegment(input) { return execute('removeSegment', input); }
  });
}

export const customerMetadataNetworkAdapterContract = Object.freeze({
  sameOriginOnly: true,
  browserScopeIsRequestOnly: true,
  serverAuthorizationAuthoritative: true,
  confirmationRequiredHere: false,
  actorSuppliedByServerSession: true,
  reasonRequired: true,
  idempotencyKeyRequired: true,
  appendOnlyActionsOnly: true,
  destructiveActionsIncluded: false,
  rawResponseExposed: false,
  productionNavigationWiring: false,
  dependenciesAdded: false
});
