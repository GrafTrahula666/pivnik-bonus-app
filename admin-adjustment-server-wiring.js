import { createAdminAdjustmentRuntime } from './admin-adjustment-runtime.js';

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

/**
 * Build and register the legacy manual bonus-adjustment route without keeping
 * financial implementation details inside server.js.
 *
 * Authorization remains exactly where it historically lived: authRequired +
 * requireRole('admin') execute before the shared route handler. The handler in
 * turn delegates all wallet/journal work to the atomic adjustment executor.
 *
 * This module is intentionally side-effect free until register() is called so
 * server composition can construct and validate dependencies before mutating
 * the Express routing table.
 */
export function createAdminAdjustmentServerWiring({
  app,
  authRequired,
  requireRole,
  pool,
  lockRequestKey,
  assertMatchingTransaction,
  hasUnlimitedBonus,
  normalizeRequestKey,
  createRuntime = createAdminAdjustmentRuntime
} = {}) {
  if (!app || typeof app.post !== 'function') throw new TypeError('app.post is required');
  requireFunction(authRequired, 'authRequired');
  requireFunction(requireRole, 'requireRole');
  requireFunction(createRuntime, 'createRuntime');

  const adminOnly = requireRole('admin');
  requireFunction(adminOnly, 'adminOnly middleware');

  const runtime = createRuntime({
    pool,
    lockRequestKey,
    assertMatchingTransaction,
    hasUnlimitedBonus,
    normalizeRequestKey
  });
  if (!runtime || typeof runtime.handler !== 'function') {
    throw new TypeError('admin adjustment runtime handler is required');
  }

  let registered = false;

  return Object.freeze({
    runtime,
    register() {
      if (registered) throw new Error('admin adjustment route already registered');
      app.post(
        '/api/admin/users/:id/adjust',
        authRequired,
        adminOnly,
        runtime.handler
      );
      registered = true;
      return runtime.handler;
    }
  });
}

export const adminAdjustmentServerWiringContract = Object.freeze({
  route: '/api/admin/users/:id/adjust',
  preservesLegacyAuthorizationOrder: true,
  role: 'admin',
  delegatesToSharedRuntime: true,
  duplicateRegistrationGuard: true,
  sideEffectFreeBeforeRegister: true,
  productionRouteWired: false,
  externalDependenciesAdded: false
});
