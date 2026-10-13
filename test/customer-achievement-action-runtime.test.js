import assert from 'node:assert/strict';
import test from 'node:test';

import { createAuthorizationContext } from '../authorization-context.js';
import {
  createCustomerAchievementActionRuntime,
  customerAchievementActionRuntimeContract
} from '../customer-achievement-action-runtime.js';

const owner = createAuthorizationContext({ membershipRole: 'owner', tenantId: 'tenant-a' });

function base(overrides = {}) {
  return {
    context: owner,
    tenantId: 'tenant-a',
    locationId: 'location-1',
    actorId: 'owner-1',
    customerId: '42',
    achievementCode: 'raise-shields',
    reason: 'Manual correction',
    requestKey: 'achievement-runtime-1',
    confirmed: true,
    ...overrides
  };
}

test('runtime binds achievement grant to canonical Customer 360 visibility proof', async () => {
  const calls = [];
  const db = { query: async () => ({ rows: [] }) };
  const runtime = createCustomerAchievementActionRuntime({
    db,
    scopedReadsEnabled: true,
    createReadRepository(options) {
      assert.equal(options.scopedReadsEnabled, true);
      return {
        async isCustomerVisible(receivedDb, customerId, scope) {
          calls.push(['visible', receivedDb, customerId, scope]);
          return true;
        }
      };
    },
    async grantAchievement(command) {
      calls.push(['grant', command]);
      return command;
    }
  });

  await runtime.grant(base());

  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], 'visible');
  assert.equal(calls[0][1], db);
  assert.equal(calls[0][2], '42');
  assert.equal(calls[0][3].tenantId, 'tenant-a');
  assert.equal(calls[0][3].locationId, 'location-1');
  assert.equal(calls[1][0], 'grant');
});

test('runtime denies invisible customer before reward executor', async () => {
  let grants = 0;
  const runtime = createCustomerAchievementActionRuntime({
    db: { query: async () => ({ rows: [] }) },
    createReadRepository() {
      return { isCustomerVisible: async () => false };
    },
    grantAchievement: async () => { grants += 1; }
  });

  await assert.rejects(runtime.grant(base()),
    (error) => error?.code === 'customer_scope_denied');
  assert.equal(grants, 0);
});

test('runtime is fail-fast on incomplete composition', () => {
  assert.throws(() => createCustomerAchievementActionRuntime(), /db.query is required/);
  assert.throws(
    () => createCustomerAchievementActionRuntime({ db: { query() {} } }),
    /grantAchievement must be a function/
  );
  assert.throws(
    () => createCustomerAchievementActionRuntime({
      db: { query() {} },
      grantAchievement() {},
      createReadRepository() { return {}; }
    }),
    /must expose isCustomerVisible/
  );
});

test('runtime contract stays scoped and production-safe', () => {
  assert.equal(customerAchievementActionRuntimeContract.visibilityBoundary, 'customer-360-read-repository');
  assert.equal(customerAchievementActionRuntimeContract.scopedFallbackToGlobal, false);
  assert.equal(customerAchievementActionRuntimeContract.duplicatesTenantOwnershipLogic, false);
  assert.equal(customerAchievementActionRuntimeContract.revokeFailClosedWithoutExecutor, true);
  assert.equal(customerAchievementActionRuntimeContract.productionRouteWired, false);
  assert.equal(customerAchievementActionRuntimeContract.migrationApplied, false);
  assert.equal(customerAchievementActionRuntimeContract.externalDependenciesAdded, false);
});
