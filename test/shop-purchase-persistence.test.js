import test from 'node:test';
import assert from 'node:assert/strict';

import { createAuthorizationContext } from '../authorization-context.js';
import {
  createShopPurchasePersistence,
  shopPurchasePersistenceContract
} from '../shop-purchase-persistence.js';

function shopTransaction(overrides = {}) {
  return {
    request_key: '00000000-0000-4000-8000-000000000002',
    client_id: 11,
    staff_id: 21,
    mode: 'shop',
    status: 'completed',
    bonus_spent: 499,
    balance_after: 501,
    reason: 'Сидр «Дальняя дача»',
    ...overrides
  };
}

test('shop adapter preserves the exact legacy INSERT before migration 009 enablement', async () => {
  const calls = [];
  const row = { id: 77, ...shopTransaction() };
  const persist = createShopPurchasePersistence({
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [row] };
    }
  });

  const result = await persist({ transaction: shopTransaction() });

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO transactions/);
  assert.match(calls[0].sql, /'shop','completed'/);
  assert.match(calls[0].sql, /NOW\(\)\) RETURNING \*/);
  assert.doesNotMatch(calls[0].sql, /tenant_id|location_id/);
  assert.deepEqual(calls[0].values, [
    '00000000-0000-4000-8000-000000000002',
    11,
    21,
    499,
    501,
    'Сидр «Дальняя дача»'
  ]);
  assert.deepEqual(result, row);
});

test('shop adapter rejects misleading scope before explicit migration enablement', async () => {
  let queries = 0;
  const persist = createShopPurchasePersistence({
    query: async () => {
      queries += 1;
      return { rows: [] };
    }
  });

  await assert.rejects(
    persist({
      tenantId: 'tenant-a',
      locationId: 'location-a',
      transaction: shopTransaction()
    }),
    (error) => error?.code === 'TRANSACTION_SCOPE_MIGRATION_GATED'
  );
  assert.equal(queries, 0);
});

test('shop adapter can use scoped persistence only after explicit enablement', async () => {
  const calls = [];
  const persist = createShopPurchasePersistence({
    scopedWritesEnabled: true,
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [{ id: 88 }] };
    }
  });

  const result = await persist({
    authorizationContext: createAuthorizationContext({
      membershipRole: 'staff',
      tenantId: 'tenant-a',
      locationId: 'location-a'
    }),
    tenantId: 'tenant-a',
    locationId: 'location-a',
    transaction: shopTransaction()
  });

  assert.equal(result.id, 88);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /tenant_id, location_id/);
  assert.equal(calls[0].values.at(-2), 'tenant-a');
  assert.equal(calls[0].values.at(-1), 'location-a');
});

test('shop adapter rejects wrong mode and status before SQL', async () => {
  let queries = 0;
  const persist = createShopPurchasePersistence({
    query: async () => {
      queries += 1;
      return { rows: [{ id: 1 }] };
    }
  });

  await assert.rejects(
    persist({ transaction: shopTransaction({ mode: 'redeem' }) }),
    /requires shop mode/
  );
  await assert.rejects(
    persist({ transaction: shopTransaction({ status: 'pending' }) }),
    /requires completed status/
  );
  assert.equal(queries, 0);
});

test('shop persistence contract remains migration-gated and legacy-by-default', () => {
  assert.equal(shopPurchasePersistenceContract.route, '/api/staff/shop/purchase');
  assert.equal(shopPurchasePersistenceContract.defaultMode, 'legacy');
  assert.equal(shopPurchasePersistenceContract.scopedWritesEnabledByDefault, false);
  assert.equal(shopPurchasePersistenceContract.preservesLegacySqlShape, true);
  assert.equal(shopPurchasePersistenceContract.preservesDatabaseNow, true);
  assert.equal(shopPurchasePersistenceContract.preservesReturningRow, true);
  assert.equal(shopPurchasePersistenceContract.requiresMigration009BeforeScopedEnablement, true);
  assert.equal(shopPurchasePersistenceContract.scopedFallbackToLegacy, false);
});
