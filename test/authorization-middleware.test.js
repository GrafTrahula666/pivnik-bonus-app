import test from 'node:test';
import assert from 'node:assert/strict';

import { createScopedAuthorizationMiddleware } from '../authorization-middleware.js';
import { createMembershipAuthorizationResolver } from '../authorization-membership.js';

function makeResolver(rowsByUser = {}) {
  return createMembershipAuthorizationResolver({
    async loadMemberships(userId) {
      return rowsByUser[String(userId)] || [];
    }
  });
}

function runMiddleware(middleware, req) {
  const result = { statusCode: 200, body: null, nextError: null, nextCalled: false };
  const res = {
    status(code) {
      result.statusCode = code;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    }
  };
  return new Promise((resolve) => {
    const next = (error) => {
      result.nextCalled = true;
      result.nextError = error || null;
      resolve(result);
    };
    Promise.resolve(middleware(req, res, next)).then(() => {
      if (!result.nextCalled) resolve(result);
    });
  });
}

test('unscoped admin endpoint preserves legacy admin-read access', async () => {
  const middleware = createScopedAuthorizationMiddleware({
    resolveAuthorization: makeResolver(),
    legacyCapability: 'adminRead',
    scopeMode: 'none'
  });

  const result = await runMiddleware(middleware, { user: { id: '7', role: 'viewer' }, query: {}, params: {} });
  assert.equal(result.statusCode, 200);
  assert.equal(result.nextCalled, true);
  assert.equal(result.nextError, null);
});

test('tenant membership alone cannot unlock an unscoped global admin endpoint', async () => {
  const middleware = createScopedAuthorizationMiddleware({
    resolveAuthorization: makeResolver({ '8': [{ role: 'owner', tenant_id: 'tenant-a' }] }),
    legacyCapability: 'adminRead',
    scopeMode: 'none'
  });

  const result = await runMiddleware(middleware, {
    user: { id: '8', role: 'client' },
    query: { tenantId: 'tenant-a' },
    params: {}
  });
  assert.equal(result.statusCode, 403);
  assert.equal(result.nextCalled, false);
});

test('owner can read only the explicitly requested tenant scope', async () => {
  const middleware = createScopedAuthorizationMiddleware({
    resolveAuthorization: makeResolver({ '9': [{ role: 'owner', tenant_id: 'tenant-a' }] }),
    legacyCapability: 'adminRead',
    scopeMode: 'tenant'
  });

  const allowed = await runMiddleware(middleware, {
    user: { id: '9', role: 'client' },
    query: { tenantId: 'tenant-a' },
    params: {}
  });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.nextCalled, true);
  assert.equal(allowed.nextError, null);
  assert.equal(allowed.body, null);

  const denied = await runMiddleware(middleware, {
    user: { id: '9', role: 'client' },
    query: { tenantId: 'tenant-b' },
    params: {}
  });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.nextCalled, false);
});

test('staff membership requires exact tenant and location scope', async () => {
  const middleware = createScopedAuthorizationMiddleware({
    resolveAuthorization: makeResolver({
      '10': [{ role: 'staff', tenant_id: 'tenant-a', location_id: 'location-1' }]
    }),
    legacyCapability: 'adminRead',
    scopeMode: 'location'
  });

  const allowed = await runMiddleware(middleware, {
    user: { id: '10', role: 'client' },
    query: { tenantId: 'tenant-a', locationId: 'location-1' },
    params: {}
  });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.nextCalled, true);

  const denied = await runMiddleware(middleware, {
    user: { id: '10', role: 'client' },
    query: { tenantId: 'tenant-a', locationId: 'location-2' },
    params: {}
  });
  assert.equal(denied.statusCode, 403);
});

test('missing declared scope fails closed before data access', async () => {
  const middleware = createScopedAuthorizationMiddleware({
    resolveAuthorization: makeResolver(),
    legacyCapability: 'adminRead',
    scopeMode: 'location'
  });

  const result = await runMiddleware(middleware, {
    user: { id: '11', role: 'admin' },
    query: { tenantId: 'tenant-a' },
    params: {}
  });
  assert.equal(result.statusCode, 400);
  assert.equal(result.nextCalled, false);
});

test('missing authenticated identity fails closed', async () => {
  const middleware = createScopedAuthorizationMiddleware({
    resolveAuthorization: makeResolver(),
    legacyCapability: 'adminRead'
  });

  const result = await runMiddleware(middleware, { user: null, query: {}, params: {} });
  assert.equal(result.statusCode, 401);
  assert.equal(result.nextCalled, false);
});

test('resolver errors are delegated to the application error handler', async () => {
  const expected = new Error('membership backend unavailable');
  const middleware = createScopedAuthorizationMiddleware({
    resolveAuthorization: async () => { throw expected; },
    legacyCapability: 'adminRead'
  });

  const result = await runMiddleware(middleware, { user: { id: '12', role: 'admin' }, query: {}, params: {} });
  assert.equal(result.nextCalled, true);
  assert.equal(result.nextError, expected);
});
