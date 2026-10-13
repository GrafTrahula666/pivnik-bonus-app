import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createScopeDirectoryRepository,
  scopeDirectoryRepositoryContract
} from '../scope-directory-repository.js';

function recordingQuery(rows = []) {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    return { rows };
  };
  return { query, calls };
}

test('tenant directory read is bounded and does not derive scope from activity tables', async () => {
  const { query, calls } = recordingQuery([
    { tenant_id: 'tenant-a', display_name: 'Пивник', status: 'active' }
  ]);
  const repository = createScopeDirectoryRepository({ query });

  const tenants = await repository.listTenants({ limit: 25, offset: 5 });

  assert.deepEqual(tenants, [
    { tenantId: 'tenant-a', displayName: 'Пивник', status: 'active' }
  ]);
  assert.deepEqual(calls[0].params, [true, 25, 5]);
  assert.match(calls[0].sql, /FROM spaceverse_tenants/);
  assert.doesNotMatch(calls[0].sql, /transactions|users|customer/i);
});

test('location directory always requires and binds tenant scope', async () => {
  const { query, calls } = recordingQuery([
    { location_id: 'loc-1', tenant_id: 'tenant-a', display_name: 'Удельная', status: 'active' }
  ]);
  const repository = createScopeDirectoryRepository({ query });

  const locations = await repository.listLocations({ tenantId: 'tenant-a' });

  assert.equal(locations[0].tenantId, 'tenant-a');
  assert.deepEqual(calls[0].params, ['tenant-a', true, 100, 0]);
  assert.match(calls[0].sql, /WHERE tenant_id = \$1/);
});

test('location lookup cannot fall back across tenants', async () => {
  const { query, calls } = recordingQuery([]);
  const repository = createScopeDirectoryRepository({ query });

  const location = await repository.findLocation({
    tenantId: 'tenant-a',
    locationId: 'loc-other'
  });

  assert.equal(location, null);
  assert.deepEqual(calls[0].params, ['tenant-a', 'loc-other', true]);
  assert.match(calls[0].sql, /tenant_id = \$1/);
  assert.match(calls[0].sql, /location_id = \$2/);
});

test('directory identifiers and pagination fail closed before querying', async () => {
  let called = false;
  const repository = createScopeDirectoryRepository({
    query: async () => {
      called = true;
      return { rows: [] };
    }
  });

  await assert.rejects(
    repository.listLocations({ tenantId: '   ' }),
    /tenantId is required/
  );
  await assert.rejects(
    repository.findLocation({ tenantId: 'tenant-a', locationId: '' }),
    /locationId is required/
  );
  await assert.rejects(
    repository.listTenants({ limit: 201 }),
    /limit must be an integer between 1 and 200/
  );
  await assert.rejects(
    repository.listTenants({ offset: -1 }),
    /offset must be a non-negative integer/
  );

  assert.equal(called, false);
});

test('directory contract explicitly separates discovery from authorization', () => {
  assert.equal(scopeDirectoryRepositoryContract.authoritativeSource, true);
  assert.equal(scopeDirectoryRepositoryContract.infersFromTransactions, false);
  assert.equal(scopeDirectoryRepositoryContract.authorizationGrantedByDirectory, false);
  assert.equal(scopeDirectoryRepositoryContract.requiresTenantForLocationReads, true);
  assert.equal(scopeDirectoryRepositoryContract.globalLocationFallback, false);
  assert.equal(scopeDirectoryRepositoryContract.externalDependenciesAdded, false);
});
