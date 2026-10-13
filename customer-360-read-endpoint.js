import { createScopedAuthorizationMiddleware } from './authorization-middleware.js';
import { createCustomer360ReadRuntime } from './customer-360-read-runtime.js';
import { createCustomer360ReadRouteHandler } from './customer-360-read-route-handler.js';

export const CUSTOMER_360_READ_ROUTE = '/api/spaceverse/tenants/:tenantId/customers/:customerId';

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

export function mountCustomer360ReadEndpoint({
  app,
  scopedModeEnabled = false,
  metadataReadsEnabled = false,
  resolveAuthorization,
  db,
  createRuntime = createCustomer360ReadRuntime,
  createRouteHandler = createCustomer360ReadRouteHandler,
  createAuthorizationMiddleware = createScopedAuthorizationMiddleware
} = {}) {
  if (typeof scopedModeEnabled !== 'boolean') throw new TypeError('scopedModeEnabled must be boolean');
  if (typeof metadataReadsEnabled !== 'boolean') throw new TypeError('metadataReadsEnabled must be boolean');
  if (!scopedModeEnabled) return Object.freeze({ mounted: false, route: CUSTOMER_360_READ_ROUTE });

  if (!app || typeof app.get !== 'function') throw new TypeError('app.get is required');
  requireFunction(resolveAuthorization, 'resolveAuthorization');
  requireFunction(createRuntime, 'createRuntime');
  requireFunction(createRouteHandler, 'createRouteHandler');
  requireFunction(createAuthorizationMiddleware, 'createAuthorizationMiddleware');

  const authorizationMiddleware = createAuthorizationMiddleware({
    resolveAuthorization,
    legacyCapability: 'adminRead',
    scopeMode: 'tenant'
  });
  const runtime = createRuntime({ db, scopedReadsEnabled: true, metadataReadsEnabled });
  if (!runtime || typeof runtime.getCustomerCard !== 'function') {
    throw new TypeError('Customer 360 runtime must expose getCustomerCard');
  }
  const handler = createRouteHandler({ getCustomerCard: runtime.getCustomerCard.bind(runtime) });
  requireFunction(handler, 'customer360ReadRouteHandler');

  app.get(CUSTOMER_360_READ_ROUTE, authorizationMiddleware, handler);
  return Object.freeze({ mounted: true, route: CUSTOMER_360_READ_ROUTE, runtime });
}

export const customer360ReadEndpointContract = Object.freeze({
  failClosedWhenScopedModeDisabled: true,
  scopeMode: 'tenant',
  legacyCapability: 'adminRead',
  staffTenantWideAccess: false,
  optionalLocationFilter: true,
  metadataReadsFailClosedByDefault: true,
  metadataMigration: '010_spaceverse_customer_metadata.sql',
  readOnly: true,
  productionEnabledByDefault: false,
  externalDependenciesAdded: false
});
