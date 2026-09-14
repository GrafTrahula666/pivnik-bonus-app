import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CUSTOMER_ACHIEVEMENT_GRANT_ROUTE,
  mountCustomerAchievementGrantEndpoint
} from '../customer-achievement-grant-endpoint.js';

test('does not register achievement grant endpoint while scoped mode is disabled', () => {
  let postCalls = 0;
  const app = { post() { postCalls += 1; } };

  const result = mountCustomerAchievementGrantEndpoint({ app, scopedModeEnabled: false });

  assert.deepEqual(result, {
    mounted: false,
    route: CUSTOMER_ACHIEVEMENT_GRANT_ROUTE
  });
  assert.equal(postCalls, 0);
});

test('mounts exactly one location-scoped adminWrite grant endpoint when explicitly enabled', () => {
  const calls = [];
  const authorizationMiddleware = () => {};
  const handler = () => {};
  const runtime = { grant: async () => ({}) };
  const grantAchievement = async () => ({});
  const resolveAuthorization = async () => ({});
  const db = { query: async () => ({ rowCount: 0, rows: [] }) };

  let authorizationOptions;
  let runtimeOptions;
  let routeHandlerOptions;

  const result = mountCustomerAchievementGrantEndpoint({
    app: { post(...args) { calls.push(args); } },
    scopedModeEnabled: true,
    resolveAuthorization,
    db,
    grantAchievement,
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
  assert.equal(result.route, CUSTOMER_ACHIEVEMENT_GRANT_ROUTE);
  assert.equal(result.runtime, runtime);
  assert.deepEqual(calls, [[CUSTOMER_ACHIEVEMENT_GRANT_ROUTE, authorizationMiddleware, handler]]);
  assert.deepEqual(authorizationOptions, {
    resolveAuthorization,
    legacyCapability: 'adminWrite',
    scopeMode: 'location'
  });
  assert.equal(runtimeOptions.db, db);
  assert.equal(runtimeOptions.grantAchievement, grantAchievement);
  assert.equal(runtimeOptions.scopedReadsEnabled, true);
  assert.equal(routeHandlerOptions.grant, runtime.grant);
  assert.equal('revokeAchievement' in runtimeOptions, false);
});

test('validates enabled wiring before route registration', () => {
  const app = { post() { assert.fail('route must not be registered'); } };

  assert.throws(
    () => mountCustomerAchievementGrantEndpoint({ app, scopedModeEnabled: true }),
    /resolveAuthorization must be a function/
  );

  assert.throws(
    () => mountCustomerAchievementGrantEndpoint({
      app,
      scopedModeEnabled: true,
      resolveAuthorization: async () => ({}),
      grantAchievement: async () => ({})
    }),
    /db\.query is required/
  );
});

test('rejects a runtime that does not expose grant', () => {
  assert.throws(
    () => mountCustomerAchievementGrantEndpoint({
      app: { post() { assert.fail('route must not be registered'); } },
      scopedModeEnabled: true,
      resolveAuthorization: async () => ({}),
      db: { query: async () => ({ rowCount: 0, rows: [] }) },
      grantAchievement: async () => ({}),
      createAuthorizationMiddleware: () => () => {},
      createRuntime: () => ({}),
      createRouteHandler: () => () => {}
    }),
    /runtime must expose grant/i
  );
});
