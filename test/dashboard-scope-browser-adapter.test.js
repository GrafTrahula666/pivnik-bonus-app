import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDashboardScopeBrowserAdapter,
  dashboardScopeBrowserAdapterContract
} from '../dashboard-scope-browser-adapter.js';

test('scope browser adapter lists tenants from the fixed same-origin directory route', async () => {
  const calls = [];
  const adapter = createDashboardScopeBrowserAdapter({
    fetchImpl: async (...args) => {
      calls.push(args);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          tenants: [
            { tenantId: 'tenant-a', displayName: 'Бар A' },
            { tenantId: 'tenant-b', displayName: 'Бар B' }
          ]
        })
      };
    }
  });

  assert.deepEqual(await adapter.loadTenants(), [
    { tenantId: 'tenant-a', displayName: 'Бар A' },
    { tenantId: 'tenant-b', displayName: 'Бар B' }
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/api/spaceverse/session/dashboard-scopes');
  assert.deepEqual(calls[0][1], {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' }
  });
});

test('location directory request only narrows through an encoded tenant query', async () => {
  const calls = [];
  const adapter = createDashboardScopeBrowserAdapter({
    fetchImpl: async (...args) => {
      calls.push(args);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          tenant: { tenantId: 'tenant/a', displayName: 'Бар A' },
          locations: [{ locationId: 'loc-1', displayName: 'Удельная' }]
        })
      };
    }
  });

  assert.deepEqual(await adapter.loadLocations('tenant/a'), {
    tenant: { tenantId: 'tenant/a', displayName: 'Бар A' },
    locations: [{ locationId: 'loc-1', displayName: 'Удельная' }]
  });
  assert.equal(calls[0][0], '/api/spaceverse/session/dashboard-scopes?tenantId=tenant%2Fa');
  assert.equal(calls[0][1].method, 'GET');
  assert.equal(calls[0][1].credentials, 'same-origin');
});

test('selection sends only requested identifiers and accepts only the exact server-authorized scope', async () => {
  const calls = [];
  const adapter = createDashboardScopeBrowserAdapter({
    fetchImpl: async (...args) => {
      calls.push(args);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          scope: { tenantId: 'tenant-a', locationId: 'loc-1', role: 'platform_admin' }
        })
      };
    }
  });

  assert.deepEqual(await adapter.selectScope({ tenantId: 'tenant-a', locationId: 'loc-1' }), {
    tenantId: 'tenant-a',
    locationId: 'loc-1'
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/api/spaceverse/session/dashboard-scope/select');
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].credentials, 'same-origin');
  assert.deepEqual(JSON.parse(calls[0][1].body), {
    tenantId: 'tenant-a',
    locationId: 'loc-1'
  });
});

test('selection fails closed if server returns a different tenant or location', async () => {
  const wrongTenant = createDashboardScopeBrowserAdapter({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, scope: { tenantId: 'tenant-b', locationId: null } })
    })
  });
  await assert.rejects(
    wrongTenant.selectScope({ tenantId: 'tenant-a' }),
    /dashboard_scope_selection_mismatch/
  );

  const widenedLocation = createDashboardScopeBrowserAdapter({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, scope: { tenantId: 'tenant-a', locationId: 'loc-2' } })
    })
  });
  await assert.rejects(
    widenedLocation.selectScope({ tenantId: 'tenant-a' }),
    /dashboard_scope_selection_mismatch/
  );
});

test('directory fails closed on malformed, mismatched or denied responses', async () => {
  const mismatched = createDashboardScopeBrowserAdapter({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        tenant: { tenantId: 'tenant-b', displayName: 'Бар B' },
        locations: []
      })
    })
  });
  await assert.rejects(mismatched.loadLocations('tenant-a'), /dashboard_scope_directory_mismatch/);

  const malformed = createDashboardScopeBrowserAdapter({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, tenants: [{ tenantId: '', displayName: 'Bad' }] })
    })
  });
  await assert.rejects(malformed.loadTenants(), /tenantId/);

  const denied = createDashboardScopeBrowserAdapter({
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      json: async () => ({ ok: false, error: 'dashboard_scope_forbidden' })
    })
  });
  await assert.rejects(denied.loadLocations('tenant-a'), /dashboard_scope_forbidden/);
});

test('adapter never accepts caller supplied endpoint and records no client authority', () => {
  assert.equal(dashboardScopeBrowserAdapterContract.fixedSameOriginRoutes, true);
  assert.equal(dashboardScopeBrowserAdapterContract.directoryReadOnly, true);
  assert.equal(dashboardScopeBrowserAdapterContract.selectionPersistsClientAuthority, false);
  assert.equal(dashboardScopeBrowserAdapterContract.selectedScopeMustMatchServerResponse, true);
  assert.equal(dashboardScopeBrowserAdapterContract.acceptsArbitraryEndpoint, false);
  assert.equal(dashboardScopeBrowserAdapterContract.externalDependenciesAdded, false);
  assert.equal(dashboardScopeBrowserAdapterContract.environmentVariablesAdded, false);
});
