import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CUSTOMER_BONUS_ADJUSTMENT_ROUTE,
  mountCustomerBonusAdjustmentEndpoint
} from '../customer-bonus-adjustment-endpoint.js';

test('does not register the endpoint while scoped mode is disabled', () => {
  let postCalls = 0;
  const app = { post() { postCalls += 1; } };

  const result = mountCustomerBonusAdjustmentEndpoint({ app, scopedModeEnabled: false });

  assert.deepEqual(result, {
    mounted: false,
    route: CUSTOMER_BONUS_ADJUSTMENT_ROUTE
  });
  assert.equal(postCalls, 0);
});

test('mounts exactly one location-scoped adminWrite endpoint when explicitly enabled', () => {
  const calls = [];
  const authorizationMiddleware = () => {};
  const handler = () => {};
  const runtime = { adjust: async () => ({ balanceAfter: 10 }) };
  const executeAdjustment = async () => ({ balanceAfter: 10 });
  const resolveAuthorization = async () => ({});
  const db = { query: async () => ({ rowCount: 0, rows: [] }) };

  const app = {
    post(...args) {
      calls.push(args);
    }
  };

  let authorizationOptions;
  let runtimeOptions;
  let routeHandlerOptions;

  const result = mountCustomerBonusAdjustmentEndpoint({
    app,
    scopedModeEnabled: true,
    resolveAuthorization,
    db,
    executeAdjustment,
    createAuthorizationMiddleware(options) {
      authorizationOptions = options;
      return authorizationMiddleware;
    },
    createRuntime(options) {
      runtimeOptions = options;
      return runtime;
    },
    createRouteHandler(options) {
      routeHandlerOptions = options;
      return handler;
    }
  });

  assert.equal(result.mounted, true);
  assert.equal(result.route, CUSTOMER_BONUS_ADJUSTMENT_ROUTE);
  assert.equal(result.runtime, runtime);
  assert.deepEqual(calls, [[CUSTOMER_BONUS_ADJUSTMENT_ROUTE, authorizationMiddleware, handler]]);
  assert.deepEqual(authorizationOptions, {
    resolveAuthorization,
    legacyCapability: 'adminWrite',
    scopeMode: 'location'
  });
  assert.equal(runtimeOptions.db, db);
  assert.equal(runtimeOptions.executeAdjustment, executeAdjustment);
  assert.equal(runtimeOptions.scopedReadsEnabled, true);
  assert.equal(routeHandlerOptions.adjust, runtime.adjust);
});

test('validates enabled wiring dependencies before route registration', () => {
  const app = { post() { assert.fail('route must not be registered'); } };

  assert.throws(
    () => mountCustomerBonusAdjustmentEndpoint({ app, scopedModeEnabled: true }),
    /resolveAuthorization must be a function/
  );

  assert.throws(
    () => mountCustomerBonusAdjustmentEndpoint({
      app,
      scopedModeEnabled: true,
      resolveAuthorization: async () => ({}),
      executeAdjustment: async () => ({})
    }),
    /db\.query is required/
  );
});

test('rejects a runtime that does not expose adjust', () => {
  assert.throws(
    () => mountCustomerBonusAdjustmentEndpoint({
      app: { post() { assert.fail('route must not be registered'); } },
      scopedModeEnabled: true,
      resolveAuthorization: async () => ({}),
      db: { query: async () => ({ rowCount: 0, rows: [] }) },
      executeAdjustment: async () => ({}),
      createAuthorizationMiddleware: () => () => {},
      createRuntime: () => ({}),
      createRouteHandler: () => () => {}
    }),
    /runtime must expose adjust/i
  );
});
