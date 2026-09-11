import test from 'node:test';
import assert from 'node:assert/strict';

import { createAuthorizationContext } from '../authorization-context.js';
import {
  beerGiftTransactionPersistenceContract,
  createBeerGiftTransactionPersistence
} from '../beer-gift-transaction-persistence.js';

function beerGiftTransaction(overrides = {}) {
  return {
    request_key: '00000000-0000-4000-8000-000000000004',
    client_id: 11,
    staff_id: 21,
    mode: 'beer_gift',
    status: 'completed',
    check_amount_cents: 0,
    cash_paid_cents: 0,
    balance_after: 1125,
    beer_gift_spent_ml: 1000,
    reason: 'Выдан подарочный объём 1 л',
    ...overrides
  };
}

test('beer gift adapter preserves the exact legacy INSERT before migration 009 enablement', async () => {
  const calls = [];
  const row = { id: 79, ...beerGiftTransaction() };
  const persist = createBeerGiftTransactionPersistence({
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [row] };
    }
  });

  const result = await persist({ transaction: beerGiftTransaction() });

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO transactions/);
  assert.match(calls[0].sql, /'beer_gift','completed',0,0/);
  assert.match(calls[0].sql, /NOW\(\)\)\s*RETURNING \*/s);
  assert.doesNotMatch(calls[0].sql, /tenant_id|location_id/);
  assert.deepEqual(calls[0].values, [
    '00000000-0000-4000-8000-000000000004',
    11,
    21,
    1125,
    1000,
    'Выдан подарочный объём 1 л'
  ]);
  assert.deepEqual(result, row);
});

test('beer gift adapter rejects misleading scope before explicit migration enablement', async () => {
  let queries = 0;
  const persist = createBeerGiftTransactionPersistence({
    query: async () => {
      queries += 1;
      return { rows: [] };
    }
  });

  await assert.rejects(
    persist({
      tenantId: 'tenant-a',
      locationId: 'location-a',
      transaction: beerGiftTransaction()
    }),
    (error) => error?.code === 'TRANSACTION_SCOPE_MIGRATION_GATED'
  );
  assert.equal(queries, 0);
});

test('beer gift adapter can use scoped persistence only after explicit enablement', async () => {
  const calls = [];
  const persist = createBeerGiftTransactionPersistence({
    scopedWritesEnabled: true,
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [{ id: 89 }] };
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
    transaction: beerGiftTransaction()
  });

  assert.equal(result.id, 89);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /tenant_id, location_id/);
  assert.equal(calls[0].values.at(-2), 'tenant-a');
  assert.equal(calls[0].values.at(-1), 'location-a');
});

test('beer gift adapter rejects wrong mode and status before SQL', async () => {
  let queries = 0;
  const persist = createBeerGiftTransactionPersistence({
    query: async () => {
      queries += 1;
      return { rows: [{ id: 1 }] };
    }
  });

  await assert.rejects(
    persist({ transaction: beerGiftTransaction({ mode: 'accrue' }) }),
    /requires beer_gift mode/
  );
  await assert.rejects(
    persist({ transaction: beerGiftTransaction({ status: 'pending' }) }),
    /requires completed status/
  );
  assert.equal(queries, 0);
});

test('beer gift adapter validates legacy database response shape', async () => {
  const missingRows = createBeerGiftTransactionPersistence({
    query: async () => ({ rowCount: 1 })
  });
  await assert.rejects(
    missingRows({ transaction: beerGiftTransaction() }),
    /must resolve to an object with rows\[\]/
  );

  const duplicateRows = createBeerGiftTransactionPersistence({
    query: async () => ({ rows: [{ id: 1 }, { id: 2 }] })
  });
  await assert.rejects(
    duplicateRows({ transaction: beerGiftTransaction() }),
    /must return exactly one row/
  );
});

test('beer gift persistence contract remains migration-gated and legacy-by-default', () => {
  assert.equal(beerGiftTransactionPersistenceContract.route, '/api/staff/beer-gift');
  assert.equal(beerGiftTransactionPersistenceContract.mode, 'beer_gift');
  assert.equal(beerGiftTransactionPersistenceContract.defaultMode, 'legacy');
  assert.equal(beerGiftTransactionPersistenceContract.scopedWritesEnabledByDefault, false);
  assert.equal(beerGiftTransactionPersistenceContract.preservesLegacySqlShape, true);
  assert.equal(beerGiftTransactionPersistenceContract.preservesDatabaseNow, true);
  assert.equal(beerGiftTransactionPersistenceContract.preservesReturningRow, true);
  assert.equal(beerGiftTransactionPersistenceContract.requiresMigration009BeforeScopedEnablement, true);
  assert.equal(beerGiftTransactionPersistenceContract.scopedFallbackToLegacy, false);
});
