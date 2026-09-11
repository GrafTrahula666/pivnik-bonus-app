import test from 'node:test';
import assert from 'node:assert/strict';

import { createAuthorizationContext } from '../authorization-context.js';
import {
  createScopedTransactionPersistence,
  transactionPersistenceContract
} from '../transaction-persistence.js';

function ownerContext() {
  return createAuthorizationContext({ membershipRole: 'owner', tenantId: 'tenant-a' });
}

test('scoped transaction writer parameterizes business data and appends tenant/location', async () => {
  const calls = [];
  const insert = createScopedTransactionPersistence({
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [{ id: 42, tenant_id: values.at(-2), location_id: values.at(-1) }] };
    }
  });

  const row = await insert({
    authorizationContext: ownerContext(),
    tenantId: 'tenant-a',
    locationId: 'location-1',
    transaction: {
      request_key: "req-'quoted'",
      client_id: 100,
      staff_id: 7,
      mode: 'accrue',
      status: 'completed',
      check_amount_cents: 250000,
      bonus_earned: 125,
      reason: "guest's purchase"
    }
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /^INSERT INTO transactions \(/);
  assert.match(calls[0].sql, /tenant_id, location_id\) VALUES \(/);
  assert.match(calls[0].sql, /RETURNING \*$/);
  assert.doesNotMatch(calls[0].sql, /req-'quoted'|guest's purchase|tenant-a|location-1/);
  assert.deepEqual(calls[0].values.slice(-2), ['tenant-a', 'location-1']);
  assert.deepEqual(row, { id: 42, tenant_id: 'tenant-a', location_id: 'location-1' });
  assert.equal(Object.isFrozen(row), true);
});

test('every current business transaction mode uses the same scoped contract', async () => {
  const seen = [];
  const insert = createScopedTransactionPersistence({
    query: async (sql, values) => {
      seen.push({ sql, values });
      return { rows: [{ id: seen.length }] };
    }
  });

  for (const mode of transactionPersistenceContract.modes) {
    await insert({
      authorizationContext: ownerContext(),
      tenantId: 'tenant-a',
      locationId: 'location-1',
      transaction: { request_key: `req-${mode}`, client_id: 1, mode }
    });
  }

  assert.deepEqual(
    transactionPersistenceContract.modes,
    ['accrue', 'redeem', 'adjustment', 'beer_gift', 'welcome', 'shop']
  );
  assert.equal(seen.length, transactionPersistenceContract.modes.length);
  for (const call of seen) {
    assert.match(call.sql, /tenant_id, location_id/);
    assert.deepEqual(call.values.slice(-2), ['tenant-a', 'location-1']);
  }
});

test('writer fails before SQL on cross-tenant or cross-location scope', async () => {
  let queryCalls = 0;
  const insert = createScopedTransactionPersistence({
    query: async () => {
      queryCalls += 1;
      return { rows: [{}] };
    }
  });
  const staff = createAuthorizationContext({
    membershipRole: 'staff',
    tenantId: 'tenant-a',
    locationId: 'location-1'
  });

  await assert.rejects(
    insert({
      authorizationContext: staff,
      tenantId: 'tenant-b',
      locationId: 'location-1',
      transaction: { client_id: 1, mode: 'accrue' }
    }),
    (error) => error?.code === 'TRANSACTION_SCOPE_FORBIDDEN'
  );
  await assert.rejects(
    insert({
      authorizationContext: staff,
      tenantId: 'tenant-a',
      locationId: 'location-2',
      transaction: { client_id: 1, mode: 'redeem' }
    }),
    (error) => error?.code === 'TRANSACTION_SCOPE_FORBIDDEN'
  );
  assert.equal(queryCalls, 0);
});

test('writer rejects unknown columns and unsupported modes before SQL', async () => {
  let queryCalls = 0;
  const insert = createScopedTransactionPersistence({
    query: async () => {
      queryCalls += 1;
      return { rows: [{}] };
    }
  });

  await assert.rejects(
    insert({
      authorizationContext: ownerContext(),
      tenantId: 'tenant-a',
      locationId: 'location-1',
      transaction: { client_id: 1, mode: 'accrue', tenant_id: 'tenant-b' }
    }),
    /Unsupported transaction column: tenant_id/
  );
  await assert.rejects(
    insert({
      authorizationContext: ownerContext(),
      tenantId: 'tenant-a',
      locationId: 'location-1',
      transaction: { client_id: 1, mode: 'made_up_mode' }
    }),
    /Unsupported transaction mode/
  );
  await assert.rejects(
    insert({
      authorizationContext: ownerContext(),
      tenantId: 'tenant-a',
      locationId: 'location-1',
      transaction: { mode: 'accrue' }
    }),
    /transaction\.client_id is required/
  );
  assert.equal(queryCalls, 0);
});

test('writer validates persistence result instead of silently accepting malformed writes', async () => {
  const malformed = createScopedTransactionPersistence({ query: async () => ({}) });
  await assert.rejects(
    malformed({
      authorizationContext: ownerContext(),
      tenantId: 'tenant-a',
      locationId: 'location-1',
      transaction: { client_id: 1, mode: 'shop' }
    }),
    /rows\[\]/
  );

  const duplicate = createScopedTransactionPersistence({ query: async () => ({ rows: [{}, {}] }) });
  await assert.rejects(
    duplicate({
      authorizationContext: ownerContext(),
      tenantId: 'tenant-a',
      locationId: 'location-1',
      transaction: { client_id: 1, mode: 'shop' }
    }),
    /exactly one row/
  );
});

test('persistence contract is explicitly migration-gated and never backfills history', () => {
  assert.equal(transactionPersistenceContract.appliesTo, 'new-transactions-only');
  assert.equal(transactionPersistenceContract.table, 'transactions');
  assert.deepEqual(transactionPersistenceContract.requiredScopeColumns, ['tenant_id', 'location_id']);
  assert.equal(transactionPersistenceContract.parameterizedValuesOnly, true);
  assert.equal(transactionPersistenceContract.historicalBackfill, false);
  assert.equal(transactionPersistenceContract.productionWiringEnabled, false);
  assert.equal(transactionPersistenceContract.writableColumns.includes('tenant_id'), false);
  assert.equal(transactionPersistenceContract.writableColumns.includes('location_id'), false);
});
