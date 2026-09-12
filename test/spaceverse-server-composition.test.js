import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mountSpaceverseServerComposition,
  spaceverseServerCompositionContract
} from '../spaceverse-server-composition.js';

test('default production runtime keeps SPACEVERSE HTTP composition disabled without dependencies', () => {
  let calls = 0;
  const result = mountSpaceverseServerComposition({
    mountActionEndpoints() {
      calls += 1;
      return { mounted: true };
    }
  });

  assert.deepEqual(result, { mounted: false, actions: null });
  assert.equal(calls, 0);
});

test('explicit enabled runtime delegates one composition with unchanged dependencies', () => {
  const app = { post() {} };
  const db = { query: async () => ({ rowCount: 0, rows: [] }) };
  const resolveAuthorization = async () => ({});
  const executeAdjustment = async () => ({});
  const grantAchievement = async () => ({});
  let received;
  const actions = { mounted: true, bonusAdjustment: {}, achievementGrant: {} };

  const result = mountSpaceverseServerComposition({
    app,
    runtime: { scopedModeEnabled: true },
    resolveAuthorization,
    db,
    executeAdjustment,
    grantAchievement,
    mountActionEndpoints(options) {
      received = options;
      return actions;
    }
  });

  assert.deepEqual(received, {
    app,
    scopedModeEnabled: true,
    resolveAuthorization,
    db,
    executeAdjustment,
    grantAchievement
  });
  assert.deepEqual(result, { mounted: true, actions });
});

test('fails closed for malformed runtime before delegating', () => {
  let calls = 0;
  const mountActionEndpoints = () => {
    calls += 1;
    return { mounted: true };
  };

  assert.throws(
    () => mountSpaceverseServerComposition({ runtime: {}, mountActionEndpoints }),
    /runtime\.scopedModeEnabled must be boolean/
  );
  assert.throws(
    () => mountSpaceverseServerComposition({ runtime: { scopedModeEnabled: 'true' }, mountActionEndpoints }),
    /runtime\.scopedModeEnabled must be boolean/
  );
  assert.equal(calls, 0);
});

test('enabled composition refuses a delegated non-mount result', () => {
  assert.throws(
    () => mountSpaceverseServerComposition({
      runtime: { scopedModeEnabled: true },
      mountActionEndpoints: () => ({ mounted: false })
    }),
    /action endpoints failed to mount/i
  );
});

test('server composition contract preserves fail-closed rollout boundaries', () => {
  assert.equal(spaceverseServerCompositionContract.productionEnabledByDefault, false);
  assert.equal(spaceverseServerCompositionContract.disabledModeRequiresNoRuntimeDependencies, true);
  assert.equal(spaceverseServerCompositionContract.ownsBusinessLogic, false);
  assert.equal(spaceverseServerCompositionContract.ownsPersistence, false);
  assert.equal(spaceverseServerCompositionContract.ownsAuthorizationRules, false);
  assert.equal(spaceverseServerCompositionContract.requiresMountBeforeLegacyApiBoundary, true);
  assert.equal(spaceverseServerCompositionContract.externalDependenciesAdded, false);
});
