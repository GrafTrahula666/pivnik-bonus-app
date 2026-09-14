import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CUSTOMER_METADATA_ROUTES,
  mountCustomerMetadataEndpoints
} from '../customer-metadata-endpoint.js';

test('does not register metadata endpoints while scoped mode is disabled', () => {
  let postCalls = 0;
  const result = mountCustomerMetadataEndpoints({
    app: { post() { postCalls += 1; } },
    scopedModeEnabled: false
  });

  assert.deepEqual(result, { mounted: false, routes: CUSTOMER_METADATA_ROUTES });
  assert.equal(postCalls, 0);
});

test('mounts all metadata mutations behind exact-location staff scope', () => {
  const calls = [];
  const authorizationMiddleware = () => {};
  const resolveAuthorization = async () => ({});
  const db = { query: async () => ({ rows: [] }) };
  const runtime = {
    addNote: async () => ({}),
    addTag: async () => ({}),
    removeTag: async () => ({}),
    addSegment: async () => ({}),
    removeSegment: async () => ({})
  };
  let authorizationOptions;
  let runtimeOptions;
  const handlers = [];

  const result = mountCustomerMetadataEndpoints({
    app: { post(...args) { calls.push(args); } },
    scopedModeEnabled: true,
    resolveAuthorization,
    db,
    createAuthorizationMiddleware(options) {
      authorizationOptions = options;
      return authorizationMiddleware;
    },
    createRuntime(options) {
      runtimeOptions = options;
      return runtime;
    },
    createRouteHandler(options) {
      handlers.push(options);
      return () => {};
    }
  });

  assert.equal(result.mounted, true);
  assert.deepEqual(authorizationOptions, {
    resolveAuthorization,
    legacyCapability: 'staff',
    scopeMode: 'location'
  });
  assert.deepEqual(runtimeOptions, { db, scopedReadsEnabled: true });
  assert.equal(calls.length, 5);
  assert.deepEqual(calls.map(([route]) => route), Object.values(CUSTOMER_METADATA_ROUTES));
  assert.ok(calls.every(([, middleware]) => middleware === authorizationMiddleware));
  assert.deepEqual(handlers.map(({ mutation }) => mutation), Object.keys(CUSTOMER_METADATA_ROUTES));
  for (const { mutation, execute } of handlers) {
    assert.equal(execute, runtime[mutation]);
  }
});

test('validates enabled dependencies before any route is registered', () => {
  const app = { post() { assert.fail('route must not be registered'); } };
  assert.throws(
    () => mountCustomerMetadataEndpoints({ app, scopedModeEnabled: true }),
    /resolveAuthorization must be a function/
  );
  assert.throws(
    () => mountCustomerMetadataEndpoints({
      app,
      scopedModeEnabled: true,
      resolveAuthorization: async () => ({})
    }),
    /db\.query is required/
  );
});

test('fails closed when runtime does not expose every metadata mutation', () => {
  assert.throws(
    () => mountCustomerMetadataEndpoints({
      app: { post() { assert.fail('route must not be registered'); } },
      scopedModeEnabled: true,
      resolveAuthorization: async () => ({}),
      db: { query: async () => ({ rows: [] }) },
      createAuthorizationMiddleware: () => () => {},
      createRuntime: () => ({ addNote: async () => ({}) }),
      createRouteHandler: () => () => {}
    }),
    /runtime\.addTag must be a function/
  );
});
