import assert from 'node:assert/strict';
import test from 'node:test';

import {
  achievementTransactionPersistenceContract,
  createAchievementTransactionPersistence
} from '../achievement-transaction-persistence.js';

function sampleTransaction() {
  return {
    request_key: 'achievement:42:first-purchase',
    client_id: 42,
    mode: 'achievement',
    status: 'completed',
    bonus_earned: 10,
    beer_gift_earned_ml: 0,
    balance_after: 110,
    reason: 'Достижение «Первый тост» — 10 бонусов',
    reward_code: 'achievement:first-purchase'
  };
}

test('legacy mode preserves achievement journal SQL and parameterization', async () => {
  const calls = [];
  const persist = createAchievementTransactionPersistence({
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [] };
    }
  });

  const result = await persist({ transaction: sampleTransaction() });
  assert.equal(result, null);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO transactions/);
  assert.match(calls[0].sql, /'achievement'/);
  assert.match(calls[0].sql, /NOW\(\)/);
  assert.doesNotMatch(calls[0].sql, /tenant_id|location_id/);
  assert.deepEqual(calls[0].values, [
    'achievement:42:first-purchase',
    42,
    10,
    0,
    110,
    'Достижение «Первый тост» — 10 бонусов',
    'achievement:first-purchase'
  ]);
});

test('legacy mode rejects explicit tenant scope before migration 009', async () => {
  let queried = false;
  const persist = createAchievementTransactionPersistence({
    query: async () => {
      queried = true;
      return { rows: [] };
    }
  });

  await assert.rejects(
    persist({
      tenantId: 'tenant-a',
      locationId: 'location-a',
      transaction: sampleTransaction()
    }),
    (error) => error?.code === 'TRANSACTION_SCOPE_MIGRATION_GATED'
  );
  assert.equal(queried, false);
});

test('scoped mode fails closed on cross-tenant achievement attribution', async () => {
  let queried = false;
  const persist = createAchievementTransactionPersistence({
    scopedWritesEnabled: true,
    query: async () => {
      queried = true;
      return { rows: [{ id: 1 }] };
    }
  });

  await assert.rejects(
    persist({
      authorizationContext: {
        platformRole: null,
        membershipRole: 'owner',
        tenantId: 'tenant-a',
        locationId: null
      },
      tenantId: 'tenant-b',
      locationId: 'location-b',
      transaction: sampleTransaction()
    }),
    (error) => error?.code === 'TRANSACTION_SCOPE_FORBIDDEN'
  );
  assert.equal(queried, false);
});

test('scoped mode writes tenant and location through the shared persistence boundary', async () => {
  const calls = [];
  const persist = createAchievementTransactionPersistence({
    scopedWritesEnabled: true,
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [{ id: 99, tenant_id: 'tenant-a', location_id: 'location-a' }] };
    }
  });

  const result = await persist({
    authorizationContext: {
      platformRole: null,
      membershipRole: 'owner',
      tenantId: 'tenant-a',
      locationId: null
    },
    tenantId: 'tenant-a',
    locationId: 'location-a',
    transaction: sampleTransaction()
  });

  assert.equal(result.id, 99);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /tenant_id, location_id/);
  assert.equal(calls[0].values.at(-2), 'tenant-a');
  assert.equal(calls[0].values.at(-1), 'location-a');
});

test('adapter only accepts completed achievement transactions', async () => {
  const persist = createAchievementTransactionPersistence({
    query: async () => ({ rows: [] })
  });

  await assert.rejects(
    persist({ transaction: { ...sampleTransaction(), mode: 'shop' } }),
    /achievement mode/
  );
  await assert.rejects(
    persist({ transaction: { ...sampleTransaction(), status: 'pending' } }),
    /completed status/
  );
});

test('contract keeps scoped achievement writes disabled by default', () => {
  assert.equal(achievementTransactionPersistenceContract.defaultMode, 'legacy');
  assert.equal(achievementTransactionPersistenceContract.scopedWritesEnabledByDefault, false);
  assert.equal(achievementTransactionPersistenceContract.requiresMigration009BeforeScopedEnablement, true);
  assert.equal(achievementTransactionPersistenceContract.scopedFallbackToLegacy, false);
  assert.equal(achievementTransactionPersistenceContract.changesRewardGrantAtomicity, false);
});
