import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CUSTOMER_360_READ_ROUTE,
  mountCustomer360ReadEndpoint,
  customer360ReadEndpointContract
} from '../customer-360-read-endpoint.js';

test('Customer 360 read endpoint stays dependency-free while scoped rollout is disabled', () => {
  let calls = 0;
  const result = mountCustomer360ReadEndpoint({
    scopedModeEnabled: false,
    createRuntime() { calls += 1; },
    createRouteHandler() { calls += 1; },
    createAuthorizationMiddleware() { calls += 1; }
  });
  assert.deepEqual(result, { mounted: false, route: CUSTOMER_360_READ_ROUTE });
  assert.equal(calls, 0);
});

test('Customer 360 read endpoint mounts tenant-manager scoped middleware and runtime', () => {
  const registrations = [];
  const app = { get(...args) { registrations.push(args); } };
  const db = { query: async () => ({ rows: [] }) };
  const resolveAuthorization = async () => ({});
  const runtime = { getCustomerCard: async () => null };
  const middleware = () => {};
  const handler = () => {};
  let middlewareOptions;
  let runtimeOptions;
  let handlerOptions;

  const result = mountCustomer360ReadEndpoint({
    app,
    scopedModeEnabled: true,
    resolveAuthorization,
    db,
    createAuthorizationMiddleware(options) { middlewareOptions = options; return middleware; },
    createRuntime(options) { runtimeOptions = options; return runtime; },
    createRouteHandler(options) { handlerOptions = options; return handler; }
  });

  assert.equal(result.mounted, true);
  assert.equal(result.runtime, runtime);
  assert.equal(middlewareOptions.resolveAuthorization, resolveAuthorization);
  assert.equal(middlewareOptions.legacyCapability, 'adminRead');
  assert.equal(middlewareOptions.scopeMode, 'tenant');
  assert.deepEqual(runtimeOptions, { db, scopedReadsEnabled: true });
  assert.equal(typeof handlerOptions.getCustomerCard, 'function');
  assert.deepEqual(registrations[0], [CUSTOMER_360_READ_ROUTE, middleware, handler]);
});

test('Customer 360 read endpoint contract forbids staff tenant-wide reads', () => {
  assert.equal(customer360ReadEndpointContract.scopeMode, 'tenant');
  assert.equal(customer360ReadEndpointContract.staffTenantWideAccess, false);
  assert.equal(customer360ReadEndpointContract.readOnly, true);
  assert.equal(customer360ReadEndpointContract.externalDependenciesAdded, false);
});
