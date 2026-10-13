const SCOPE_KEYS = ['tenantId', 'locationId', 'tenant_id', 'location_id', 'authorizationContext', 'spaceverseAuthorization'];
const SCOPE_HEADERS = ['x-tenant-id', 'x-location-id', 'x-spaceverse-tenant-id', 'x-spaceverse-location-id'];

function supplied(object, key) {
  return object instanceof URLSearchParams ? object.has(key) : Object.hasOwn(object || {}, key);
}

export function assertLegacyScopeBody(body) {
  if (SCOPE_KEYS.some((key) => supplied(body, key))) {
    throw Object.assign(new Error('Для tenant/location используйте SPACEVERSE API.'), {
      statusCode: 409, code: 'SCOPED_REQUEST_ON_LEGACY_API'
    });
  }
}

/** The legacy application is global. Never interpret a scoped request there. */
export function assertLegacyApiRequest(req, { scopedModeEnabled = false } = {}) {
  if (typeof scopedModeEnabled !== 'boolean') throw new TypeError('scopedModeEnabled must be boolean');
  const url = new URL(req.originalUrl || req.url || '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return;
  // Scoped handlers must be mounted before this boundary, never fall through it.
  if (scopedModeEnabled || req.spaceverseAuthorization?.mode === 'scoped') {
    throw Object.assign(new Error('Этот legacy API недоступен в scoped mode.'), {
      statusCode: 409, code: 'LEGACY_API_DISABLED_IN_SCOPED_MODE'
    });
  }
  assertLegacyScopeBody(url.searchParams);
  assertLegacyScopeBody(req.query);
  assertLegacyScopeBody(req.body);
  if (SCOPE_HEADERS.some((key) => supplied(req.headers, key))) {
    throw Object.assign(new Error('Scoped-запрос нельзя выполнить глобально.'), {
      statusCode: 409, code: 'SCOPED_REQUEST_ON_LEGACY_API'
    });
  }
}
