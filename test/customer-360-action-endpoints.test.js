import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mountCustomer360ActionEndpoints,
  customer360ActionEndpointsContract
} from '../customer-360-action-endpoints.js';

test('registers nothing and requires no runtime dependencies while scoped mode is disabled', () => {
  let postCalls = 0;
  const result = mountCustomer360ActionEndpoints({
    app: { post() { postCalls += 1; } },
    scopedModeEnabled: false
  });

  assert.deepEqual(result, {
    mounted: false,
    bonusAdjustment: null,
    achievementGrant: null
  });
  assert.equal(postCalls, 0);
});

test('mounts bonus and achievement endpoints through one enabled scoped boundary', () => {
  const app = { post() {} };
  const db = { query: async () => ({ rowCount: 0, rows: [] }) };
  const resolveAuthorization = async () => ({});
  const executeAdjustment = async () => ({});
  const grantAchievement = async () => ({});
  const calls = [];

  const bonusResult = { mounted: true, route: '/bonus' };
  const achievementResult = { mounted: true, route: '/achievement' };

  const result = mountCustomer360ActionEndpoints({
    app,
    scopedModeEnabled: true,
    resolveAuthorization,
    db,
    executeAdjustment,
    grantAchievement,
    mountBonusAdjustmentEndpoint(options) {
      calls.push(['bonus', options]);
      return bonusResult;
    },
    mountAchievementGrantEndpoint(options) {
      calls.push(['achievement', options]);
      return achievementResult;
    }
  });

  assert.equal(result.mounted, true);
  assert.equal(result.bonusAdjustment, bonusResult);
  assert.equal(result.achievementGrant, achievementResult);
  assert.equal(calls.length, 2);

  assert.deepEqual(calls[0], ['bonus', {
    app,
    scopedModeEnabled: true,
    resolveAuthorization,
    db,
    executeAdjustment
  }]);
  assert.deepEqual(calls[1], ['achievement', {
    app,
    scopedModeEnabled: true,
    resolveAuthorization,
    db,
    grantAchievement
  }]);
});

test('validates enabled composition before mounting any endpoint', () => {
  let mounts = 0;
  const common = {
    app: { post() {} },
    scopedModeEnabled: true,
    mountBonusAdjustmentEndpoint() { mounts += 1; return { mounted: true }; },
    mountAchievementGrantEndpoint() { mounts += 1; return { mounted: true }; }
  };

  assert.throws(
    () => mountCustomer360ActionEndpoints(common),
    /resolveAuthorization must be a function/
  );
  assert.equal(mounts, 0);

  assert.throws(
    () => mountCustomer360ActionEndpoints({
      ...common,
      resolveAuthorization: async () => ({})
    }),
    /executeAdjustment must be a function/
  );
  assert.equal(mounts, 0);

  assert.throws(
    () => mountCustomer360ActionEndpoints({
      ...common,
      resolveAuthorization: async () => ({}),
      executeAdjustment: async () => ({})
    }),
    /grantAchievement must be a function/
  );
  assert.equal(mounts, 0);
});

test('fails closed when a delegated endpoint refuses to mount', () => {
  const common = {
    app: { post() {} },
    scopedModeEnabled: true,
    resolveAuthorization: async () => ({}),
    db: { query: async () => ({ rowCount: 0, rows: [] }) },
    executeAdjustment: async () => ({}),
    grantAchievement: async () => ({})
  };

  assert.throws(
    () => mountCustomer360ActionEndpoints({
      ...common,
      mountBonusAdjustmentEndpoint: () => ({ mounted: false }),
      mountAchievementGrantEndpoint: () => ({ mounted: true })
    }),
    /bonus adjustment endpoint failed to mount/i
  );

  assert.throws(
    () => mountCustomer360ActionEndpoints({
      ...common,
      mountBonusAdjustmentEndpoint: () => ({ mounted: true }),
      mountAchievementGrantEndpoint: () => ({ mounted: false })
    }),
    /achievement grant endpoint failed to mount/i
  );
});

test('contract keeps rollout and destructive achievement behavior fail-closed', () => {
  assert.equal(customer360ActionEndpointsContract.failClosedWhenScopedModeDisabled, true);
  assert.equal(customer360ActionEndpointsContract.sharedScopedRolloutBoundary, true);
  assert.equal(customer360ActionEndpointsContract.revokeExposed, false);
  assert.equal(customer360ActionEndpointsContract.productionEnabledByDefault, false);
  assert.equal(customer360ActionEndpointsContract.externalDependenciesAdded, false);
});
