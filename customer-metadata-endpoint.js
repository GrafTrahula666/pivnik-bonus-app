import { createScopedAuthorizationMiddleware } from './authorization-middleware.js';
import { createCustomerMetadataRuntime } from './customer-metadata-runtime.js';
import { createCustomerMetadataRouteHandler } from './customer-metadata-route-handler.js';

const BASE = '/api/spaceverse/tenants/:tenantId/locations/:locationId/customers/:id';
export const CUSTOMER_METADATA_ROUTES = Object.freeze({
  addNote: `${BASE}/notes`,
  addTag: `${BASE}/tags`,
  removeTag: `${BASE}/tags/remove`,
  addSegment: `${BASE}/segments`,
  removeSegment: `${BASE}/segments/remove`
});

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

export function mountCustomerMetadataEndpoints({
  app,
  scopedModeEnabled = false,
  resolveAuthorization,
  db,
  createRuntime = createCustomerMetadataRuntime,
  createRouteHandler = createCustomerMetadataRouteHandler,
  createAuthorizationMiddleware = createScopedAuthorizationMiddleware
} = {}) {
  if (typeof scopedModeEnabled !== 'boolean') {
    throw new TypeError('scopedModeEnabled must be boolean');
  }
  if (!scopedModeEnabled) {
    return Object.freeze({ mounted: false, routes: CUSTOMER_METADATA_ROUTES });
  }

  if (!app || typeof app.post !== 'function') throw new TypeError('app.post is required');
  requireFunction(resolveAuthorization, 'resolveAuthorization');
  requireFunction(createRuntime, 'createRuntime');
  requireFunction(createRouteHandler, 'createRouteHandler');
  requireFunction(createAuthorizationMiddleware, 'createAuthorizationMiddleware');
  if (!db || typeof db.query !== 'function') throw new TypeError('db.query is required');

  const authorizationMiddleware = createAuthorizationMiddleware({
    resolveAuthorization,
    legacyCapability: 'staff',
    scopeMode: 'location'
  });
  const runtime = createRuntime({ db, scopedReadsEnabled: true });

  for (const mutation of Object.keys(CUSTOMER_METADATA_ROUTES)) {
    requireFunction(runtime?.[mutation], `runtime.${mutation}`);
  }

  const handlers = {};
  for (const [mutation, route] of Object.entries(CUSTOMER_METADATA_ROUTES)) {
    const handler = createRouteHandler({ mutation, execute: runtime[mutation] });
    requireFunction(handler, `${mutation}RouteHandler`);
    handlers[mutation] = handler;
    app.post(route, authorizationMiddleware, handler);
  }

  return Object.freeze({
    mounted: true,
    routes: CUSTOMER_METADATA_ROUTES,
    runtime,
    handlers: Object.freeze(handlers)
  });
}

export const customerMetadataEndpointContract = Object.freeze({
  failClosedWhenScopedModeDisabled: true,
  scopeMode: 'location',
  legacyCapability: 'staff',
  staffLimitedToExactLocation: true,
  canonicalCustomerVisibilityProof: true,
  appendOnlyPersistence: true,
  requiresMountBeforeLegacyApiBoundary: true,
  productionEnabledByDefault: false,
  externalDependenciesAdded: false
});
