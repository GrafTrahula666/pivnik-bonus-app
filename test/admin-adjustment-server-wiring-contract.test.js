import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAdminAdjustmentServerWiring,
  adminAdjustmentServerWiringContract
} from '../admin-adjustment-server-wiring.js';

test('legacy adjustment wiring preserves auth order and remains side-effect free before register', () => {
  const registrations = [];
  const app = {
    post(...args) {
      registrations.push(args);
    }
  };
  const authRequired = () => {};
  const requireRole = (role) => {
    assert.equal(role, 'admin');
    return () => {};
  };
  let created = 0;
  const createRuntime = (deps) => {
    created += 1;
    assert.equal(typeof deps.normalizeRequestKey, 'function');
    return { handler: () => {} };
  };

  const wiring = createAdminAdjustmentServerWiring({
    app,
    authRequired,
    requireRole,
    normalizeRequestKey: (value) => value,
    createRuntime
  });

  assert.equal(created, 1);
  assert.equal(registrations.length, 0);
  assert.equal(wiring.runtime.handler instanceof Function, true);
  assert.equal(adminAdjustmentServerWiringContract.sideEffectFreeBeforeRegister, true);
});

test('legacy adjustment wiring registers one fixed route with auth then admin middleware', () => {
  const registrations = [];
  const app = {
    post(...args) {
      registrations.push(args);
    }
  };
  const authRequired = () => {};
  const adminOnly = () => {};
  const requireRole = (role) => {
    assert.equal(role, 'admin');
    return adminOnly;
  };
  const handler = () => {};

  const wiring = createAdminAdjustmentServerWiring({
    app,
    authRequired,
    requireRole,
    normalizeRequestKey: (value) => value,
    createRuntime: () => ({ handler })
  });

  wiring.register();

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0][0], '/api/admin/users/:id/adjust');
  assert.equal(registrations[0][1], authRequired);
  assert.equal(registrations[0][2], adminOnly);
  assert.equal(registrations[0][3], handler);
});

test('legacy adjustment wiring rejects duplicate registration', () => {
  const app = { post() {} };
  const wiring = createAdminAdjustmentServerWiring({
    app,
    authRequired: () => {},
    requireRole: () => () => {},
    normalizeRequestKey: (value) => value,
    createRuntime: () => ({ handler: () => {} })
  });

  wiring.register();
  assert.throws(() => wiring.register(), /already registered/);
});
