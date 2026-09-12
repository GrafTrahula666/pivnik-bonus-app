import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adminAdjustmentServerWiringContract,
  createAdminAdjustmentServerWiring
} from '../admin-adjustment-server-wiring.js';

test('server wiring preserves legacy auth order and delegates route to runtime handler', () => {
  const calls = [];
  const handler = async () => {};
  const authRequired = () => {};
  const adminOnly = () => {};

  const wiring = createAdminAdjustmentServerWiring({
    app: {
      post(...args) { calls.push(args); }
    },
    authRequired,
    requireRole(role) {
      calls.push(['requireRole', role]);
      return adminOnly;
    },
    pool: { connect() {} },
    lockRequestKey() {},
    assertMatchingTransaction() {},
    hasUnlimitedBonus() { return false; },
    normalizeRequestKey(value) { return String(value || '').trim(); },
    createRuntime(options) {
      calls.push(['runtime', options]);
      return { executeAdjustment: async () => ({}), handler };
    }
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], ['requireRole', 'admin']);
  assert.equal(calls[1][0], 'runtime');
  assert.equal(calls.some((entry) => entry[0] === '/api/admin/users/:id/adjust'), false);

  const registeredHandler = wiring.register();
  assert.equal(registeredHandler, handler);
  assert.equal(calls.length, 3);
  assert.equal(calls[2][0], '/api/admin/users/:id/adjust');
  assert.equal(calls[2][1], authRequired);
  assert.equal(calls[2][2], adminOnly);
  assert.equal(calls[2][3], handler);
});

test('server wiring is fail-fast and refuses accidental duplicate route registration', () => {
  assert.throws(
    () => createAdminAdjustmentServerWiring({}),
    /app.post is required/
  );

  assert.throws(
    () => createAdminAdjustmentServerWiring({
      app: { post() {} },
      authRequired() {},
      requireRole() { return null; }
    }),
    /adminOnly middleware must be a function/
  );

  const wiring = createAdminAdjustmentServerWiring({
    app: { post() {} },
    authRequired() {},
    requireRole() { return () => {}; },
    createRuntime() { return { handler: async () => {} }; }
  });

  wiring.register();
  assert.throws(() => wiring.register(), /route already registered/);
});

test('server wiring passes existing legacy dependencies unchanged into shared runtime', () => {
  const pool = { connect() {} };
  const lockRequestKey = () => {};
  const assertMatchingTransaction = () => {};
  const hasUnlimitedBonus = () => false;
  const normalizeRequestKey = () => 'rk';
  let received;

  createAdminAdjustmentServerWiring({
    app: { post() {} },
    authRequired() {},
    requireRole() { return () => {}; },
    pool,
    lockRequestKey,
    assertMatchingTransaction,
    hasUnlimitedBonus,
    normalizeRequestKey,
    createRuntime(options) {
      received = options;
      return { handler: async () => {} };
    }
  });

  assert.equal(received.pool, pool);
  assert.equal(received.lockRequestKey, lockRequestKey);
  assert.equal(received.assertMatchingTransaction, assertMatchingTransaction);
  assert.equal(received.hasUnlimitedBonus, hasUnlimitedBonus);
  assert.equal(received.normalizeRequestKey, normalizeRequestKey);
});

test('server wiring contract records migration boundary without claiming production is switched', () => {
  assert.equal(adminAdjustmentServerWiringContract.route, '/api/admin/users/:id/adjust');
  assert.equal(adminAdjustmentServerWiringContract.preservesLegacyAuthorizationOrder, true);
  assert.equal(adminAdjustmentServerWiringContract.role, 'admin');
  assert.equal(adminAdjustmentServerWiringContract.delegatesToSharedRuntime, true);
  assert.equal(adminAdjustmentServerWiringContract.duplicateRegistrationGuard, true);
  assert.equal(adminAdjustmentServerWiringContract.sideEffectFreeBeforeRegister, true);
  assert.equal(adminAdjustmentServerWiringContract.productionRouteWired, false);
  assert.equal(adminAdjustmentServerWiringContract.externalDependenciesAdded, false);
});
