import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDashboardSessionScopeAdapter,
  dashboardSessionScopeAdapterContract
} from '../dashboard-session-scope-adapter.js';
import { DASHBOARD_SESSION_SCOPE_ROUTE } from '../dashboard-session-scope-endpoint.js';

test('browser adapter requests only the fixed same-origin session scope route', async () => {
  const calls = [];
  const resolveSessionScope = createDashboardSessionScopeAdapter({
    fetchImpl: async (...args) => {
      calls.push(args);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          scope: { tenantId: 'tenant-a', locationId: null }
        })
      };
    }
  });

  const scope = await resolveSessionScope();
  assert.deepEqual(scope, { tenantId: 'tenant-a', locationId: null });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], DASHBOARD_SESSION_SCOPE_ROUTE);
  assert.deepEqual(calls[0][1], {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' }
  });
  assert.equal(calls[0][0].includes('tenant-a'), false);
});

test('browser adapter preserves a server-authorized optional location', async () => {
  const resolveSessionScope = createDashboardSessionScopeAdapter({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        scope: { tenantId: 'tenant-a', locationId: 'location-1' }
      })
    })
  });

  assert.deepEqual(await resolveSessionScope(), {
    tenantId: 'tenant-a',
    locationId: 'location-1'
  });
});

test('browser adapter fails closed on HTTP denial and keeps the server error code', async () => {
  const resolveSessionScope = createDashboardSessionScopeAdapter({
    fetchImpl: async () => ({
      ok: false,
      status: 409,
      json: async () => ({ ok: false, error: 'scope_selection_required' })
    })
  });

  await assert.rejects(
    resolveSessionScope(),
    (error) => error.code === 'scope_selection_required' && error.status === 409
  );
});

test('browser adapter fails closed on malformed or unsafe scope payloads', async () => {
  const malformed = createDashboardSessionScopeAdapter({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, scope: { tenantId: '' } })
    })
  });
  await assert.rejects(malformed(), /session tenantId/);

  const invalidJson = createDashboardSessionScopeAdapter({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('bad json'); }
    })
  });
  await assert.rejects(invalidJson(), /invalid JSON/);
});

test('adapter contract has no tenant/location inputs and no production auto-wiring', () => {
  assert.equal(dashboardSessionScopeAdapterContract.tenantInputAccepted, false);
  assert.equal(dashboardSessionScopeAdapterContract.locationInputAccepted, false);
  assert.equal(dashboardSessionScopeAdapterContract.autoWiring, false);
  assert.equal(dashboardSessionScopeAdapterContract.productionNavigationWiring, false);
  assert.equal(dashboardSessionScopeAdapterContract.externalDependenciesAdded, false);
});
