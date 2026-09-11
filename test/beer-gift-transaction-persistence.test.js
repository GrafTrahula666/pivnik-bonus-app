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

test('beer gift scoped mode preserves legacy zero check and cash semantics', async () => {
  const calls = [];
  const persist = createBeerGiftTransactionPersistence({
    scopedWritesEnabled: true,
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [{ id: 91 }] };
    }
  });
  const scope = {
    authorizationContext: createAuthorizationContext({
      membershipRole: 'staff',
      tenantId: 'tenant-a',
      locationId: 'location-a'
    }),
    tenantId: 'tenant-a',
    locationId: 'location-a'
  };

  const withoutExplicitZeros = beerGiftTransaction();
  delete withoutExplicitZeros.check_amount_cents;
  delete withoutExplicitZeros.cash_paid_cents;
  await persist({ ...scope, transaction: withoutExplicitZeros });

  assert.equal(calls.length, 1);
  const normalizedSql = calls[0].sql;
  const normalizedValues = calls[0].values;
  const columns = normalizedSql.match(/INSERT INTO transactions \(([^)]+)\)/)?.[1]
    .split(',')
    .map((column) => column.trim());
  assert.equal(normalizedValues[columns.indexOf('check_amount_cents')], 0);
  assert.equal(normalizedValues[columns.indexOf('cash_paid_cents')], 0);

  let rejectedQueries = 0;
  const rejectingPersist = createBeerGiftTransactionPersistence({
    scopedWritesEnabled: true,
    query: async () => {
      rejectedQueries += 1;
      return { rows: [{ id: 92 }] };
    }
  });
  await assert.rejects(
    rejectingPersist({ ...scope, transaction: beerGiftTransaction({ check_amount_cents: 100 }) }),
    /requires zero check_amount_cents/
  );
  await assert.rejects(
    rejectingPersist({ ...scope, transaction: beerGiftTransaction({ cash_paid_cents: 100 }) }),
    /requires zero cash_paid_cents/
  );
  assert.equal(rejectedQueries, 0);
});

test('beer gift adapter enforces gift invariants before SQL in legacy mode', async () => {
  let queries = 0;
  const persist = createBeerGiftTransactionPersistence({
    query: async () => {
      queries += 1;
      return { rows: [{ id: 93 }] };
    }
  });

  const invalidCases = [
    [beerGiftTransaction({ request_key: '   ' }), /requires request_key/],
    [beerGiftTransaction({ client_id: 0 }), /positive safe integer client_id/],
    [beerGiftTransaction({ staff_id: -1 }), /positive safe integer staff_id/],
    [beerGiftTransaction({ balance_after: -1 }), /non-negative safe integer balance_after/],
    [beerGiftTransaction({ beer_gift_spent_ml: 0 }), /positive safe integer beer_gift_spent_ml/],
    [beerGiftTransaction({ beer_gift_spent_ml: Number.MAX_SAFE_INTEGER + 1 }), /positive safe integer beer_gift_spent_ml/],
    [beerGiftTransaction({ reason: ' ' }), /requires reason/]
  ];

  for (const [transaction, pattern] of invalidCases) {
    await assert.rejects(persist({ transaction }), pattern);
  }
  assert.equal(queries, 0);
});

test('beer gift scoped mode enforces the same gift invariants before SQL', async () => {
  let queries = 0;
  const persist = createBeerGiftTransactionPersistence({
    scopedWritesEnabled: true,
    query: async () => {
      queries += 1;
      return { rows: [{ id: 94 }] };
    }
  });
  const scope = {
    authorizationContext: createAuthorizationContext({
      membershipRole: 'staff',
      tenantId: 'tenant-a',
      locationId: 'location-a'
    }),
    tenantId: 'tenant-a',
    locationId: 'location-a'
  };

  await assert.rejects(
    persist({ ...scope, transaction: beerGiftTransaction({ beer_gift_spent_ml: 0 }) }),
    /positive safe integer beer_gift_spent_ml/
  );
  await assert.rejects(
    persist({ ...scope, transaction: beerGiftTransaction({ balance_after: -1 }) }),
    /non-negative safe integer balance_after/
  );
  assert.equal(queries, 0);
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
  assert.equal(beerGiftTransactionPersistenceContract.preservesZeroCheckAndCashSemantics, true);
  assert.equal(beerGiftTransactionPersistenceContract.validatesGiftInvariantsBeforeSql, true);
  assert.equal(beerGiftTransactionPersistenceContract.requiresMigration009BeforeScopedEnablement, true);
  assert.equal(beerGiftTransactionPersistenceContract.scopedFallbackToLegacy, false);
});
