import test from 'node:test';
import assert from 'node:assert/strict';

import { createDashboardScopeDirectoryResolver } from '../dashboard-scope-directory-resolver.js';
import { mountDashboardScopeDirectoryEndpoint } from '../dashboard-scope-directory-endpoint.js';

function ownerAuthorization(tenantId) {
  return { context: { platformRole: null, membershipRole: 'owner', tenantId, locationId: null } };
}

function platformAuthorization() {
  return { context: { platformRole: 'platform_admin', membershipRole: null, tenantId: null, locationId: null } };
}

function directory() {
  const tenants = [
    { tenantId: 'tenant-a', displayName: 'Alpha' },
    { tenantId: 'tenant-b', displayName: 'Beta' }
  ];
  const locations = {
    'tenant-a': [{ tenantId: 'tenant-a', locationId: 'loc-a1', displayName: 'Alpha One' }],
    'tenant-b': [{ tenantId: 'tenant-b', locationId: 'loc-b1', displayName: 'Beta One' }]
  };
  return {
    async listTenants() { return tenants; },
    async findTenant({ tenantId }) { return tenants.find((tenant) => tenant.tenantId === tenantId) || null; },
    async listLocations({ tenantId }) { return locations[tenantId] || []; }
  };
}

test('owner tenant directory exposes only owned active tenants', async () => {
  let globalDirectoryRead = false;
  const base = directory();
  const resolve = createDashboardScopeDirectoryResolver({
    loadMemberships: async () => [{ role: 'owner', tenantId: 'tenant-b' }],
    resolveAuthorization: async ({ tenantId }) => ownerAuthorization(tenantId),
    scopeDirectory: {
      ...base,
      async listTenants() { globalDirectoryRead = true; return base.listTenants(); }
    }
  });

  const result = await resolve({ userId: '42' });
  assert.deepEqual(result, { tenants: [{ tenantId: 'tenant-b', displayName: 'Beta' }] });
  assert.equal(globalDirectoryRead, false);
});

test('owner cannot probe another tenant locations', async () => {
  let locationRead = false;
  const base = directory();
  const resolve = createDashboardScopeDirectoryResolver({
    loadMemberships: async () => [{ role: 'owner', tenantId: 'tenant-a' }],
    resolveAuthorization: async ({ tenantId }) => ownerAuthorization(tenantId),
    scopeDirectory: {
      ...base,
      async listLocations(input) { locationRead = true; return base.listLocations(input); }
    }
  });

  await assert.rejects(
    resolve({ userId: '42', tenantId: 'tenant-b' }),
    (error) => error.code === 'dashboard_scope_forbidden'
  );
  assert.equal(locationRead, false);
});

test('platform admin receives active directory tenants and locations after canonical authorization', async () => {
  let membershipsLoaded = false;
  const resolve = createDashboardScopeDirectoryResolver({
    loadMemberships: async () => { membershipsLoaded = true; return []; },
    resolveAuthorization: async () => platformAuthorization(),
    scopeDirectory: directory()
  });

  assert.deepEqual(await resolve({ userId: '42', platformRole: 'platform_admin' }), {
    tenants: [
      { tenantId: 'tenant-a', displayName: 'Alpha' },
      { tenantId: 'tenant-b', displayName: 'Beta' }
    ]
  });
  assert.deepEqual(await resolve({ userId: '42', platformRole: 'platform_admin', tenantId: 'tenant-a' }), {
    tenant: { tenantId: 'tenant-a', displayName: 'Alpha' },
    locations: [{ locationId: 'loc-a1', displayName: 'Alpha One' }]
  });
  assert.equal(membershipsLoaded, false);
});

test('canonical authorization filters tenant listing instead of trusting membership alone', async () => {
  const resolve = createDashboardScopeDirectoryResolver({
    loadMemberships: async () => [
      { role: 'owner', tenantId: 'tenant-a' },
      { role: 'owner', tenantId: 'tenant-b' }
    ],
    resolveAuthorization: async ({ tenantId }) => tenantId === 'tenant-a'
      ? ownerAuthorization('tenant-a')
      : { context: { platformRole: null, membershipRole: null, tenantId: null, locationId: null } },
    scopeDirectory: directory()
  });

  assert.deepEqual(await resolve({ userId: '42' }), {
    tenants: [{ tenantId: 'tenant-a', displayName: 'Alpha' }]
  });
});

test('scope directory endpoint ignores body scope and forwards only authenticated query narrowing', async () => {
  let handler;
  let resolverInput;
  mountDashboardScopeDirectoryEndpoint({
    app: { get(_route, nextHandler) { handler = nextHandler; } },
    scopedModeEnabled: true,
    resolveDashboardScopeDirectory: async (input) => {
      resolverInput = input;
      return { tenant: { tenantId: 'tenant-a', displayName: 'Alpha' }, locations: [] };
    }
  });

  let payload;
  const headers = new Map();
  const res = {
    set(name, value) { headers.set(name, value); return this; },
    status() { throw new Error('unexpected status'); },
    json(value) { payload = value; return value; }
  };
  await handler({
    user: { id: '42', platformRole: null, role: 'admin' },
    query: { tenantId: 'tenant-a' },
    body: { tenantId: 'tenant-b', platformRole: 'platform_admin' }
  }, res, (error) => { throw error; });

  assert.deepEqual(resolverInput, {
    userId: '42',
    platformRole: null,
    legacyRole: 'admin',
    tenantId: 'tenant-a'
  });
  assert.equal(payload.ok, true);
  assert.equal(headers.get('Cache-Control'), 'no-store');
});

test('scope directory endpoint stays unmounted while scoped rollout is disabled', () => {
  let registered = false;
  const result = mountDashboardScopeDirectoryEndpoint({
    app: { get() { registered = true; } },
    scopedModeEnabled: false
  });
  assert.equal(result.mounted, false);
  assert.equal(registered, false);
});
