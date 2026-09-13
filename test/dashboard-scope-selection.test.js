import test from 'node:test';
import assert from 'node:assert/strict';

import { createDashboardScopeSelectionResolver } from '../dashboard-scope-selection-resolver.js';
import { mountDashboardScopeSelectionEndpoint } from '../dashboard-scope-selection-endpoint.js';

function ownerAuthorization(tenantId) {
  return {
    context: {
      platformRole: null,
      membershipRole: 'owner',
      tenantId,
      locationId: null
    }
  };
}

test('multi-owner may explicitly select only an owned tenant', async () => {
  const calls = [];
  const select = createDashboardScopeSelectionResolver({
    loadMemberships: async () => [
      { role: 'owner', tenantId: 'tenant-a' },
      { role: 'owner', tenantId: 'tenant-b' }
    ],
    resolveAuthorization: async (input) => {
      calls.push(input);
      return ownerAuthorization(input.tenantId);
    }
  });

  const scope = await select({ userId: '42', legacyRole: 'admin', tenantId: 'tenant-b' });
  assert.deepEqual(scope, { tenantId: 'tenant-b', locationId: null });
  assert.deepEqual(calls, [{
    userId: '42',
    platformRole: null,
    legacyRole: 'admin',
    tenantId: 'tenant-b',
    locationId: null
  }]);
});

test('arbitrary browser tenant cannot create authority', async () => {
  let authorizationCalled = false;
  const select = createDashboardScopeSelectionResolver({
    loadMemberships: async () => [{ role: 'owner', tenantId: 'tenant-a' }],
    resolveAuthorization: async () => {
      authorizationCalled = true;
      return ownerAuthorization('attacker-tenant');
    }
  });

  await assert.rejects(
    select({ userId: '42', tenantId: 'attacker-tenant' }),
    (error) => error.code === 'dashboard_scope_forbidden' && error.statusCode === 403
  );
  assert.equal(authorizationCalled, false);
});

test('platform admin stays fail-closed without authoritative tenant directory', async () => {
  let membershipsLoaded = false;
  const select = createDashboardScopeSelectionResolver({
    loadMemberships: async () => {
      membershipsLoaded = true;
      return [];
    },
    resolveAuthorization: async () => ({ context: { platformRole: 'platform_admin' } })
  });

  await assert.rejects(
    select({ userId: '42', platformRole: 'platform_admin', tenantId: 'tenant-a' }),
    (error) => error.code === 'platform_scope_directory_required' && error.statusCode === 409
  );
  assert.equal(membershipsLoaded, false);
});

test('location selection stays fail-closed without authoritative directory', async () => {
  const select = createDashboardScopeSelectionResolver({
    loadMemberships: async () => [{ role: 'owner', tenantId: 'tenant-a' }],
    resolveAuthorization: async () => ownerAuthorization('tenant-a')
  });

  await assert.rejects(
    select({ userId: '42', tenantId: 'tenant-a', locationId: 'location-1' }),
    (error) => error.code === 'location_selection_unavailable' && error.statusCode === 409
  );
});

test('selection endpoint passes browser tenant only into validated selector', async () => {
  let handler = null;
  let selectorInput = null;
  mountDashboardScopeSelectionEndpoint({
    app: { post(_route, nextHandler) { handler = nextHandler; } },
    scopedModeEnabled: true,
    selectDashboardScope: async (input) => {
      selectorInput = input;
      return { tenantId: 'tenant-b', locationId: null };
    }
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
    body: { tenantId: 'tenant-b', locationId: null, role: 'platform_admin' },
    query: { tenantId: 'attacker-tenant' },
    params: { tenantId: 'attacker-tenant' }
  }, res, (error) => { throw error; });

  assert.deepEqual(selectorInput, {
    userId: '42',
    platformRole: null,
    legacyRole: 'admin',
    tenantId: 'tenant-b',
    locationId: null
  });
  assert.deepEqual(payload, { ok: true, scope: { tenantId: 'tenant-b', locationId: null } });
  assert.equal(headers.get('Cache-Control'), 'no-store');
});

test('selection endpoint is not mounted while scoped rollout is disabled', () => {
  let registered = false;
  const result = mountDashboardScopeSelectionEndpoint({
    app: { post() { registered = true; } },
    scopedModeEnabled: false
  });
  assert.equal(result.mounted, false);
  assert.equal(registered, false);
});
