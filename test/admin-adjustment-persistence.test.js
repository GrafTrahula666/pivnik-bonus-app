import test from 'node:test';
import assert from 'node:assert/strict';

import {
  adminAdjustmentPersistenceContract,
  createAdminAdjustmentPersistence
} from '../admin-adjustment-persistence.js';

function adjustment(overrides = {}) {
  return {
    request_key: '00000000-0000-4000-8000-000000000001',
    client_id: 10,
    staff_id: 20,
    mode: 'adjustment',
    status: 'completed',
    bonus_spent: 0,
    bonus_earned: 25,
    balance_after: 125,
    reason: 'manual correction',
    ...overrides
  };
}

test('admin adjustment adapter preserves the legacy INSERT before migration 009 enablement', async () => {
  const calls = [];
  const persist = createAdminAdjustmentPersistence({
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [{ id: 99, ...adjustment() }] };
    }
  });

  const result = await persist({ transaction: adjustment() });

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO transactions/);
  assert.match(calls[0].sql, /'adjustment','completed'/);
  assert.match(calls[0].sql, /NOW\(\)/);
  assert.doesNotMatch(calls[0].sql, /tenant_id|location_id/);
  assert.deepEqual(calls[0].values, [
    '00000000-0000-4000-8000-000000000001',
    10,
    20,
    0,
    25,
    125,
    'manual correction'
  ]);
  assert.equal(result.id, 99);
});

test('admin adjustment adapter refuses scope before deliberate migration enablement', async () => {
  let queries = 0;
  const persist = createAdminAdjustmentPersistence({
    query: async () => {
      queries += 1;
      return { rows: [] };
    }
  });

  await assert.rejects(
    persist({
      tenantId: 'tenant-a',
      locationId: 'location-a',
      transaction: adjustment()
    }),
    (error) => error?.code === 'TRANSACTION_SCOPE_MIGRATION_GATED'
  );
  assert.equal(queries, 0);
});

test('admin adjustment adapter can use the scoped writer only after explicit enablement', async () => {
  const calls = [];
  const persist = createAdminAdjustmentPersistence({
    scopedWritesEnabled: true,
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [{ id: 101 }] };
    }
  });

  const result = await persist({
    authorizationContext: {
      actor: { id: 'owner-1', role: 'owner' },
      memberships: [{ tenantId: 'tenant-a', locationId: 'location-a', role: 'owner' }]
    },
    tenantId: 'tenant-a',
    locationId: 'location-a',
    transaction: adjustment()
  });

  assert.equal(result.id, 101);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /tenant_id, location_id/);
  assert.equal(calls[0].values.at(-2), 'tenant-a');
  assert.equal(calls[0].values.at(-1), 'location-a');
});

test('admin adjustment adapter rejects the wrong transaction mode or status', async () => {
  const persist = createAdminAdjustmentPersistence({
    query: async () => ({ rows: [{ id: 1 }] })
  });

  await assert.rejects(
    persist({ transaction: adjustment({ mode: 'accrue' }) }),
    /requires adjustment mode/
  );
  await assert.rejects(
    persist({ transaction: adjustment({ status: 'pending' }) }),
    /requires completed status/
  );
});

test('admin adjustment persistence contract keeps scoped writes migration-gated by default', () => {
  assert.equal(adminAdjustmentPersistenceContract.route, '/api/admin/users/:id/adjust');
  assert.equal(adminAdjustmentPersistenceContract.defaultMode, 'legacy');
  assert.equal(adminAdjustmentPersistenceContract.scopedWritesEnabledByDefault, false);
  assert.equal(adminAdjustmentPersistenceContract.preservesLegacySqlShape, true);
  assert.equal(adminAdjustmentPersistenceContract.preservesDatabaseNow, true);
  assert.equal(adminAdjustmentPersistenceContract.requiresMigration009BeforeScopedEnablement, true);
  assert.equal(adminAdjustmentPersistenceContract.scopedFallbackToLegacy, false);
});
