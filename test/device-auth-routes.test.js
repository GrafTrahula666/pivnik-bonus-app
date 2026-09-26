import assert from 'node:assert/strict';
import test from 'node:test';
import { registerDeviceAuthRoutes } from '../device-auth-routes.js';

function fakeApp() {
  const routes = [];
  return {
    routes,
    post(path, ...handlers) { routes.push({ method: 'POST', path, handlers }); },
    get(path, ...handlers) { routes.push({ method: 'GET', path, handlers }); }
  };
}

const noop = (_req, _res, next) => next?.();
const persistence = {
  pairDevice() {},
  createBootstrap() {},
  exchangeBootstrap() {},
  createPairingCode() {},
  listDevices() {},
  revokeDevice() {}
};

test('device auth is fail-closed and registers nothing while disabled', () => {
  const app = fakeApp();
  const result = registerDeviceAuthRoutes({ app, enabled: false });
  assert.deepEqual(result, { registered: false });
  assert.equal(app.routes.length, 0);
});

test('enabled device auth registers only the expected isolated endpoints', () => {
  const app = fakeApp();
  const result = registerDeviceAuthRoutes({
    app,
    enabled: true,
    persistence,
    authRequired: noop,
    requireRole: () => noop,
    signSession: () => 'token',
    getProfile: async () => ({ role: 'staff' }),
    loadPublicDesign: async () => ({}),
    publicStatuses: () => []
  });
  assert.deepEqual(result, { registered: true });
  assert.deepEqual(
    app.routes.map(({ method, path }) => `${method} ${path}`),
    [
      'POST /api/device/pair',
      'POST /api/device/bootstrap',
      'POST /api/device/session',
      'POST /api/admin/devices/pairing-code',
      'GET /api/admin/devices',
      'POST /api/admin/devices/:id/revoke'
    ]
  );
});

test('admin device routes preserve auth before admin-role middleware', () => {
  const app = fakeApp();
  const authRequired = function authRequired() {};
  const adminOnly = function adminOnly() {};
  registerDeviceAuthRoutes({
    app,
    enabled: true,
    persistence,
    authRequired,
    requireRole: (role) => {
      assert.equal(role, 'admin');
      return adminOnly;
    },
    signSession: () => 'token',
    getProfile: async () => ({ role: 'staff' })
  });
  const route = app.routes.find((item) => item.path === '/api/admin/devices/pairing-code');
  assert.equal(route.handlers[0], authRequired);
  assert.equal(route.handlers[1], adminOnly);
});
