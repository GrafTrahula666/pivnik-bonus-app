import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adminAdjustmentRuntimeContract,
  createAdminAdjustmentRuntime
} from '../admin-adjustment-runtime.js';

test('admin adjustment runtime composes shared executor with legacy HTTP adapter', async () => {
  const calls = [];
  const executeAdjustment = async (command) => ({
    ok: true,
    replayed: false,
    balanceAfter: 123,
    command
  });

  const runtime = createAdminAdjustmentRuntime({
    pool: { connect() {} },
    lockRequestKey() {},
    assertMatchingTransaction() {},
    hasUnlimitedBonus() { return false; },
    normalizeRequestKey(value) { return String(value || '').trim(); },
    createExecutor(options) {
      calls.push({ type: 'executor', options });
      return executeAdjustment;
    },
    createRouteHandler(options) {
      calls.push({ type: 'handler', options });
      return async function handler() {};
    }
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].type, 'executor');
  assert.equal(calls[0].options.pool.connect instanceof Function, true);
  assert.equal(calls[0].options.lockRequestKey instanceof Function, true);
  assert.equal(calls[0].options.assertMatchingTransaction instanceof Function, true);
  assert.equal(calls[0].options.hasUnlimitedBonus instanceof Function, true);
  assert.equal(calls[1].type, 'handler');
  assert.equal(calls[1].options.executeAdjustment, executeAdjustment);
  assert.equal(calls[1].options.normalizeRequestKey instanceof Function, true);
  assert.equal(runtime.executeAdjustment, executeAdjustment);
  assert.equal(typeof runtime.handler, 'function');
  assert.equal(Object.isFrozen(runtime), true);
});

test('admin adjustment runtime rejects malformed composition before route wiring', () => {
  assert.throws(
    () => createAdminAdjustmentRuntime({}),
    /normalizeRequestKey must be a function/
  );

  assert.throws(
    () => createAdminAdjustmentRuntime({
      normalizeRequestKey() {},
      createExecutor() { return null; }
    }),
    /executeAdjustment must be a function/
  );

  assert.throws(
    () => createAdminAdjustmentRuntime({
      normalizeRequestKey() {},
      createExecutor() { return async () => ({ ok: true }); },
      createRouteHandler() { return null; }
    }),
    /adminAdjustmentRouteHandler must be a function/
  );
});

test('admin adjustment runtime contract keeps authorization and registration in server composition', () => {
  assert.equal(adminAdjustmentRuntimeContract.route, '/api/admin/users/:id/adjust');
  assert.equal(adminAdjustmentRuntimeContract.sharedAtomicExecutor, true);
  assert.equal(adminAdjustmentRuntimeContract.preservesLegacyHttpAdapter, true);
  assert.equal(adminAdjustmentRuntimeContract.ownsAuthorization, false);
  assert.equal(adminAdjustmentRuntimeContract.ownsRouteRegistration, false);
  assert.equal(adminAdjustmentRuntimeContract.productionRouteWired, false);
  assert.equal(adminAdjustmentRuntimeContract.externalDependenciesAdded, false);
});
