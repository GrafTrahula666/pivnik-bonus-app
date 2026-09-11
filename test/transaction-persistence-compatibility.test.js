import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMigrationGatedTransactionPersistence,
  transactionPersistenceCompatibilityContract
} from '../transaction-persistence-compatibility.js';

test('legacy mode preserves current persistence path before migration enablement', async () => {
  const calls = [];
  const persist = createMigrationGatedTransactionPersistence({
    legacyInsert: async (transaction) => {
      calls.push(transaction);
      return { id: 1, ...transaction };
    },
    scopedInsert: async () => {
      throw new Error('scoped writer must not run');
    }
  });

  const transaction = { client_id: 10, mode: 'adjustment', bonus_earned: 25 };
  const result = await persist({ transaction });

  assert.deepEqual(calls, [transaction]);
  assert.deepEqual(result, { id: 1, ...transaction });
});

test('legacy mode rejects misleading tenant/location scope while migration is gated', async () => {
  let legacyCalls = 0;
  const persist = createMigrationGatedTransactionPersistence({
    legacyInsert: async () => {
      legacyCalls += 1;
      return {};
    }
  });

  await assert.rejects(
    persist({
      tenantId: 'tenant-a',
      locationId: 'location-1',
      transaction: { client_id: 1, mode: 'accrue' }
    }),
    (error) => error?.code === 'TRANSACTION_SCOPE_MIGRATION_GATED'
  );
  assert.equal(legacyCalls, 0);
});

test('scoped mode has no fallback to legacy persistence', async () => {
  let legacyCalls = 0;
  let scopedCalls = 0;
  const persist = createMigrationGatedTransactionPersistence({
    scopedWritesEnabled: true,
    legacyInsert: async () => {
      legacyCalls += 1;
      return {};
    },
    scopedInsert: async (options) => {
      scopedCalls += 1;
      assert.equal(options.tenantId, 'tenant-a');
      assert.equal(options.locationId, 'location-1');
      return { id: 2 };
    }
  });

  const result = await persist({
    authorizationContext: { role: 'owner' },
    tenantId: 'tenant-a',
    locationId: 'location-1',
    transaction: { client_id: 1, mode: 'accrue' }
  });

  assert.deepEqual(result, { id: 2 });
  assert.equal(scopedCalls, 1);
  assert.equal(legacyCalls, 0);
});

test('enabling scoped writes without a scoped writer fails at construction time', () => {
  assert.throws(
    () => createMigrationGatedTransactionPersistence({
      scopedWritesEnabled: true,
      legacyInsert: async () => ({})
    }),
    /scopedInsert must be a function/
  );
});

test('compatibility contract makes migration gate explicit', () => {
  assert.equal(transactionPersistenceCompatibilityContract.defaultMode, 'legacy');
  assert.equal(transactionPersistenceCompatibilityContract.scopedWritesEnabledByDefault, false);
  assert.equal(transactionPersistenceCompatibilityContract.legacyAcceptsTenantScope, false);
  assert.equal(transactionPersistenceCompatibilityContract.scopedFallbackToLegacy, false);
  assert.equal(transactionPersistenceCompatibilityContract.requiresDeliberateMigrationEnablement, true);
});
