import test from 'node:test';
import assert from 'node:assert/strict';

import { createAuthorizationContext } from '../authorization-context.js';
import {
  createStaffTransactionPersistence,
  staffTransactionPersistenceContract
} from '../staff-transaction-persistence.js';

function staffTransaction(overrides = {}) {
  return {
    request_key: '00000000-0000-4000-8000-000000000003',
    client_id: 11,
    staff_id: 21,
    mode: 'accrue',
    status: 'completed',
    check_amount_cents: 250000,
    discount_cents: 0,
    bonus_spent: 0,
    bonus_earned: 125,
    cash_paid_cents: 250000,
    balance_after: 1125,
    is_suspicious: false,
    beer_ml: 500,
    beer_gift_earned_ml: 0,
    ...overrides
  };
}

test('staff adapter preserves the exact legacy INSERT before migration 009 enablement', async () => {
  const calls = [];
  const row = { id: 77, ...staffTransaction() };
  const persist = createStaffTransactionPersistence({
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [row] };
    }
  });

  const result = await persist({ transaction: staffTransaction() });

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO transactions/);
  assert.match(calls[0].sql, /\$4,'completed'/);
  assert.match(calls[0].sql, /NOW\(\)\)\s*RETURNING \*/s);
  assert.doesNotMatch(calls[0].sql, /tenant_id|location_id/);
  assert.deepEqual(calls[0].values, [
    '00000000-0000-4000-8000-000000000003',
    11,
    21,
    'accrue',
    250000,
    0,
    0,
    125,
    250000,
    1125,
    false,
    500,
    0
  ]);
  assert.deepEqual(result, row);
});

test('staff adapter preserves redeem mode with the same SQL contract', async () => {
  const calls = [];
  const persist = createStaffTransactionPersistence({
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [{ id: 78 }] };
    }
  });

  await persist({
    transaction: staffTransaction({
      mode: 'redeem',
      bonus_spent: 300,
      bonus_earned: 75,
      cash_paid_cents: 150000,
      balance_after: 775
    })
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].values[3], 'redeem');
  assert.equal(calls[0].values[6], 300);
  assert.equal(calls[0].values[7], 75);
  assert.equal(calls[0].values[8], 150000);
  assert.equal(calls[0].values[9], 775);
});

test('staff adapter rejects misleading scope before explicit migration enablement', async () => {
  let queries = 0;
  const persist = createStaffTransactionPersistence({
    query: async () => {
      queries += 1;
      return { rows: [] };
    }
  });

  await assert.rejects(
    persist({
      tenantId: 'tenant-a',
      locationId: 'location-a',
      transaction: staffTransaction()
    }),
    (error) => error?.code === 'TRANSACTION_SCOPE_MIGRATION_GATED'
  );
  assert.equal(queries, 0);
});

test('staff adapter can use scoped persistence only after explicit enablement', async () => {
  const calls = [];
  const persist = createStaffTransactionPersistence({
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
    transaction: staffTransaction()
  });

  assert.equal(result.id, 88);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /tenant_id, location_id/);
  assert.equal(calls[0].values.at(-2), 'tenant-a');
  assert.equal(calls[0].values.at(-1), 'location-a');
});

test('staff adapter rejects wrong mode and status before SQL', async () => {
  let queries = 0;
  const persist = createStaffTransactionPersistence({
    query: async () => {
      queries += 1;
      return { rows: [{ id: 1 }] };
    }
  });

  await assert.rejects(
    persist({ transaction: staffTransaction({ mode: 'shop' }) }),
    /requires accrue or redeem mode/
  );
  await assert.rejects(
    persist({ transaction: staffTransaction({ status: 'pending' }) }),
    /requires completed status/
  );
  assert.equal(queries, 0);
});

test('staff adapter rejects financial states the endpoint cannot produce before SQL', async () => {
  let queries = 0;
  const persist = createStaffTransactionPersistence({
    query: async () => {
      queries += 1;
      return { rows: [{ id: 1 }] };
    }
  });

  const invalidCases = [
    [staffTransaction({ bonus_spent: 1 }), /accrue transaction cannot spend bonuses/],
    [staffTransaction({ mode: 'redeem', bonus_spent: 10, discount_cents: 1 }), /redeem transaction cannot apply a status discount/],
    [staffTransaction({ mode: 'redeem', bonus_spent: 0 }), /redeem transaction must spend at least one bonus/],
    [staffTransaction({ cash_paid_cents: 250001 }), /cash_paid_cents cannot exceed check_amount_cents/],
    [staffTransaction({ check_amount_cents: -1 }), /check_amount_cents must be a non-negative safe integer/],
    [staffTransaction({ bonus_earned: 1.5 }), /bonus_earned must be a non-negative safe integer/],
    [staffTransaction({ beer_ml: Number.MAX_SAFE_INTEGER + 1 }), /beer_ml must be a non-negative safe integer/]
  ];

  for (const [transaction, expected] of invalidCases) {
    await assert.rejects(persist({ transaction }), expected);
  }
  assert.equal(queries, 0);
});

test('staff scoped mode enforces the same financial invariants before SQL', async () => {
  let queries = 0;
  const persist = createStaffTransactionPersistence({
    scopedWritesEnabled: true,
    query: async () => {
      queries += 1;
      return { rows: [{ id: 1 }] };
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
    persist({ ...scope, transaction: staffTransaction({ bonus_spent: 1 }) }),
    /accrue transaction cannot spend bonuses/
  );
  await assert.rejects(
    persist({ ...scope, transaction: staffTransaction({ mode: 'redeem', bonus_spent: 0 }) }),
    /redeem transaction must spend at least one bonus/
  );
  assert.equal(queries, 0);
});

test('staff persistence contract remains migration-gated and legacy-by-default', () => {
  assert.equal(staffTransactionPersistenceContract.route, '/api/staff/transactions');
  assert.deepEqual(staffTransactionPersistenceContract.modes, ['accrue', 'redeem']);
  assert.equal(staffTransactionPersistenceContract.defaultMode, 'legacy');
  assert.equal(staffTransactionPersistenceContract.scopedWritesEnabledByDefault, false);
  assert.equal(staffTransactionPersistenceContract.preservesLegacySqlShape, true);
  assert.equal(staffTransactionPersistenceContract.preservesDatabaseNow, true);
  assert.equal(staffTransactionPersistenceContract.preservesReturningRow, true);
  assert.equal(staffTransactionPersistenceContract.validatesEndpointFinancialInvariants, true);
  assert.equal(staffTransactionPersistenceContract.requiresMigration009BeforeScopedEnablement, true);
  assert.equal(staffTransactionPersistenceContract.scopedFallbackToLegacy, false);
});
