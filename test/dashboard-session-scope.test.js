import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDashboardSessionScopeResolver,
  DashboardSessionScopeError
} from '../dashboard-session-scope-resolver.js';
import {
  DASHBOARD_SESSION_SCOPE_ROUTE,
  mountDashboardSessionScopeEndpoint
} from '../dashboard-session-scope-endpoint.js';

function ownerAuthorization(tenantId) {
  return {
    mode: 'scoped',
    context: {
      platformRole: null,
      membershipRole: 'owner',
      tenantId,
      locationId: null
    }
  };
}

test('session scope resolves one owner tenant and rechecks authorization', async () => {
  const authorizationCalls = [];
  const resolve = createDashboardSessionScopeResolver({
    loadMemberships: async () => [
      { membership_role: 'owner', tenant_id: 'tenant-a', location_id: null },
      { membership_role: 'owner', tenant_id: 'tenant-a', location_id: null }
    ],
    resolveAuthorization: async (input) => {
      authorizationCalls.push(input);
      return ownerAuthorization('tenant-a');
    }
  });

  const scope = await resolve({ userId: '42', legacyRole: 'admin' });
  assert.deepEqual(scope, { tenantId: 'tenant-a', locationId: null });
  assert.deepEqual(authorizationCalls, [{
    userId: '42',
    platformRole: null,
    legacyRole: 'admin',
    tenantId: 'tenant-a',
    locationId: null
  }]);
});

test('session scope refuses implicit selection across multiple owner tenants', async () => {
  let authorizationCalled = false;
  const resolve = createDashboardSessionScopeResolver({
    loadMemberships: async () => [
      { role: 'owner', tenantId: 'tenant-a' },
      { role: 'owner', tenantId: 'tenant-b' }
    ],
    resolveAuthorization: async () => {
      authorizationCalled = true;
      return ownerAuthorization('tenant-a');
    }
  });

  await assert.rejects(
    resolve({ userId: '42' }),
    (error) => error instanceof DashboardSessionScopeError
      && error.code === 'scope_selection_required'
      && error.statusCode === 409
  );
  assert.equal(authorizationCalled, false);
});

test('session scope refuses implicit platform-admin tenant selection', async () => {
  let membershipsLoaded = false;
  const resolve = createDashboardSessionScopeResolver({
    loadMemberships: async () => {
      membershipsLoaded = true;
      return [];
    },
    resolveAuthorization: async () => ({})
  });

  await assert.rejects(
    resolve({ userId: '42', platformRole: 'platform_admin' }),
    (error) => error.code === 'scope_selection_required' && error.statusCode === 409
  );
  assert.equal(membershipsLoaded, false);
});

test('staff membership never becomes tenant-wide Dashboard scope', async () => {
  const resolve = createDashboardSessionScopeResolver({
    loadMemberships: async () => [
      { role: 'staff', tenantId: 'tenant-a', locationId: 'location-1' }
    ],
    resolveAuthorization: async () => {
      throw new Error('must not authorize staff for tenant-wide Dashboard');
    }
  });

  await assert.rejects(
    resolve({ userId: '42' }),
    (error) => error.code === 'dashboard_manager_required' && error.statusCode === 403
  );
});

test('discovered owner scope fails closed if canonical authorization denies it', async () => {
  const resolve = createDashboardSessionScopeResolver({
    loadMemberships: async () => [{ role: 'owner', tenantId: 'tenant-a' }],
    resolveAuthorization: async () => ({
      mode: 'scoped',
      context: { platformRole: null, membershipRole: null, tenantId: null, locationId: null }
    })
  });

  await assert.rejects(
    resolve({ userId: '42' }),
    (error) => error.code === 'dashboard_scope_forbidden' && error.statusCode === 403
  );
});

test('endpoint is not registered while scoped rollout is disabled', () => {
  let registered = false;
  const result = mountDashboardSessionScopeEndpoint({
    app: { get() { registered = true; } },
    scopedModeEnabled: false
  });

  assert.equal(result.mounted, false);
  assert.equal(result.route, DASHBOARD_SESSION_SCOPE_ROUTE);
  assert.equal(registered, false);
});

test('endpoint uses authenticated user only and returns no-store scope response', async () => {
  let route = null;
  let handler = null;
  let resolverInput = null;
  const app = {
    get(nextRoute, nextHandler) {
      route = nextRoute;
      handler = nextHandler;
    }
  };

  const result = mountDashboardSessionScopeEndpoint({
    app,
    scopedModeEnabled: true,
    resolveSessionScope: async (input) => {
      resolverInput = input;
      return Object.freeze({ tenantId: 'tenant-a', locationId: null });
    }
  });

  assert.equal(result.mounted, true);
  assert.equal(route, DASHBOARD_SESSION_SCOPE_ROUTE);

  const headers = new Map();
  let payload = null;
  const req = {
    user: { id: 42, platformRole: null, role: 'admin' },
    params: { tenantId: 'attacker-tenant' },
    query: { tenantId: 'attacker-tenant', locationId: 'attacker-location' },
    body: { tenantId: 'attacker-tenant' }
  };
  const res = {
    set(name, value) { headers.set(name, value); return this; },
    status() { throw new Error('unexpected status'); },
    json(value) { payload = value; return value; }
  };

  await handler(req, res, (error) => { throw error; });
  assert.deepEqual(resolverInput, { userId: 42, platformRole: null, legacyRole: 'admin' });
  assert.deepEqual(payload, { ok: true, scope: { tenantId: 'tenant-a', locationId: null } });
  assert.equal(headers.get('Cache-Control'), 'no-store');
});

test('endpoint maps selection-required errors without leaking membership details', async () => {
  let handler = null;
  mountDashboardSessionScopeEndpoint({
    app: { get(_route, nextHandler) { handler = nextHandler; } },
    scopedModeEnabled: true,
    resolveSessionScope: async () => {
      throw new DashboardSessionScopeError('scope_selection_required', 409, 'internal detail');
    }
  });

  let statusCode = null;
  let payload = null;
  const res = {
    set() { return this; },
    status(value) { statusCode = value; return this; },
    json(value) { payload = value; return value; }
  };

  await handler({ user: { id: '42' } }, res, (error) => { throw error; });
  assert.equal(statusCode, 409);
  assert.deepEqual(payload, { ok: false, error: 'scope_selection_required' });
  assert.equal(JSON.stringify(payload).includes('internal detail'), false);
});
