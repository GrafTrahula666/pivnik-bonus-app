import test from 'node:test';
import assert from 'node:assert/strict';

import { createDashboardScopeSelectionResolver } from '../dashboard-scope-selection-resolver.js';
import { mountDashboardScopeSelectionEndpoint } from '../dashboard-scope-selection-endpoint.js';

function ownerAuthorization(tenantId, locationId = null) {
  return { context: { platformRole: null, membershipRole: 'owner', tenantId, locationId: null } };
}

function platformAuthorization() {
  return { context: { platformRole: 'platform_admin', membershipRole: null, tenantId: null, locationId: null } };
}

function directory({ tenants = ['tenant-a', 'tenant-b'], locations = { 'tenant-a': ['location-a'], 'tenant-b': ['location-b'] } } = {}) {
  return {
    async findTenant({ tenantId }) {
      return tenants.includes(tenantId) ? { tenantId, status: 'active' } : null;
    },
    async findLocation({ tenantId, locationId }) {
      return locations[tenantId]?.includes(locationId) ? { tenantId, locationId, status: 'active' } : null;
    }
  };
}

test('multi-owner may explicitly select only an owned active tenant', async () => {
  const calls = [];
  const select = createDashboardScopeSelectionResolver({
    loadMemberships: async () => [{ role: 'owner', tenantId: 'tenant-a' }, { role: 'owner', tenantId: 'tenant-b' }],
    scopeDirectory: directory(),
    resolveAuthorization: async (input) => { calls.push(input); return ownerAuthorization(input.tenantId); }
  });
  const scope = await select({ userId: '42', legacyRole: 'admin', tenantId: 'tenant-b' });
  assert.deepEqual(scope, { tenantId: 'tenant-b', locationId: null });
  assert.equal(calls.length, 1);
});

test('arbitrary browser tenant cannot create authority or probe directory for owner', async () => {
  let directoryCalled = false;
  let authorizationCalled = false;
  const select = createDashboardScopeSelectionResolver({
    loadMemberships: async () => [{ role: 'owner', tenantId: 'tenant-a' }],
    scopeDirectory: {
      async findTenant() { directoryCalled = true; return { tenantId: 'attacker-tenant' }; },
      async findLocation() { throw new Error('unexpected'); }
    },
    resolveAuthorization: async () => { authorizationCalled = true; return ownerAuthorization('attacker-tenant'); }
  });
  await assert.rejects(select({ userId: '42', tenantId: 'attacker-tenant' }), (error) => error.code === 'dashboard_scope_forbidden');
  assert.equal(directoryCalled, false);
  assert.equal(authorizationCalled, false);
});

test('platform admin may select only an active directory tenant and is canonically re-authorized', async () => {
  let membershipsLoaded = false;
  let authorizationInput = null;
  const select = createDashboardScopeSelectionResolver({
    loadMemberships: async () => { membershipsLoaded = true; return []; },
    scopeDirectory: directory(),
    resolveAuthorization: async (input) => { authorizationInput = input; return platformAuthorization(); }
  });
  const scope = await select({ userId: '42', platformRole: 'platform_admin', tenantId: 'tenant-a' });
  assert.deepEqual(scope, { tenantId: 'tenant-a', locationId: null });
  assert.equal(membershipsLoaded, false);
  assert.equal(authorizationInput.tenantId, 'tenant-a');
});

test('owner may select an active location only inside owned tenant', async () => {
  const select = createDashboardScopeSelectionResolver({
    loadMemberships: async () => [{ role: 'owner', tenantId: 'tenant-a' }],
    scopeDirectory: directory(),
    resolveAuthorization: async (input) => ownerAuthorization(input.tenantId, input.locationId)
  });
  const scope = await select({ userId: '42', tenantId: 'tenant-a', locationId: 'location-a' });
  assert.deepEqual(scope, { tenantId: 'tenant-a', locationId: 'location-a' });
  await assert.rejects(
    select({ userId: '42', tenantId: 'tenant-a', locationId: 'location-b' }),
    (error) => error.code === 'dashboard_scope_forbidden'
  );
});

test('inactive or absent directory scope is denied before authorization', async () => {
  let authorizationCalled = false;
  const select = createDashboardScopeSelectionResolver({
    loadMemberships: async () => [{ role: 'owner', tenantId: 'tenant-a' }],
    scopeDirectory: directory({ tenants: [] }),
    resolveAuthorization: async () => { authorizationCalled = true; return ownerAuthorization('tenant-a'); }
  });
  await assert.rejects(select({ userId: '42', tenantId: 'tenant-a' }), (error) => error.code === 'dashboard_scope_forbidden');
  assert.equal(authorizationCalled, false);
});

test('selection endpoint passes browser scope only into validated selector', async () => {
  let handler = null;
  let selectorInput = null;
  mountDashboardScopeSelectionEndpoint({
    app: { post(_route, nextHandler) { handler = nextHandler; } },
    scopedModeEnabled: true,
    selectDashboardScope: async (input) => { selectorInput = input; return { tenantId: 'tenant-b', locationId: 'location-b' }; }
  });
  let payload = null;
  const headers = new Map();
  const res = {
    set(name, value) { headers.set(name, value); return this; },
    status() { throw new Error('unexpected status'); },
    json(value) { payload = value; return value; }
  };
  await handler({
    user: { id: '42', role: 'admin' },
    body: { tenantId: 'tenant-b', locationId: 'location-b', role: 'platform_admin' },
    query: { tenantId: 'attacker-tenant' },
    params: { tenantId: 'attacker-tenant' }
  }, res, (error) => { throw error; });
  assert.deepEqual(selectorInput, { userId: '42', platformRole: null, legacyRole: 'admin', tenantId: 'tenant-b', locationId: 'location-b' });
  assert.deepEqual(payload, { ok: true, scope: { tenantId: 'tenant-b', locationId: 'location-b' } });
  assert.equal(headers.get('Cache-Control'), 'no-store');
});

test('selection endpoint is not mounted while scoped rollout is disabled', () => {
  let registered = false;
  const result = mountDashboardScopeSelectionEndpoint({ app: { post() { registered = true; } }, scopedModeEnabled: false });
  assert.equal(result.mounted, false);
  assert.equal(registered, false);
});
