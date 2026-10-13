import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mountCustomer360FullActionEndpoints,
  customer360FullActionEndpointsContract
} from '../customer-360-full-action-endpoints.js';

test('registers nothing and needs no runtime dependencies when scoped mode is disabled', () => {
  let coreMounts = 0;
  let metadataMounts = 0;

  const result = mountCustomer360FullActionEndpoints({
    scopedModeEnabled: false,
    mountCoreActionEndpoints() { coreMounts += 1; },
    mountMetadataEndpoints() { metadataMounts += 1; }
  });

  assert.deepEqual(result, {
    mounted: false,
    core: null,
    metadata: null
  });
  assert.equal(coreMounts, 0);
  assert.equal(metadataMounts, 0);
});

test('mounts core and metadata endpoints behind one enabled scoped boundary', () => {
  const app = { post() {} };
  const db = { query: async () => ({ rowCount: 0, rows: [] }) };
  const resolveAuthorization = async () => ({});
  const executeAdjustment = async () => ({});
  const grantAchievement = async () => ({});
  const calls = [];
  const core = { mounted: true, id: 'core' };
  const metadata = { mounted: true, id: 'metadata' };

  const result = mountCustomer360FullActionEndpoints({
    app,
    scopedModeEnabled: true,
    resolveAuthorization,
    db,
    executeAdjustment,
    grantAchievement,
    mountCoreActionEndpoints(options) {
      calls.push(['core', options]);
      return core;
    },
    mountMetadataEndpoints(options) {
      calls.push(['metadata', options]);
      return metadata;
    }
  });

  assert.equal(result.mounted, true);
  assert.equal(result.core, core);
  assert.equal(result.metadata, metadata);
  assert.deepEqual(calls[0], ['core', {
    app,
    scopedModeEnabled: true,
    resolveAuthorization,
    db,
    executeAdjustment,
    grantAchievement
  }]);
  assert.deepEqual(calls[1], ['metadata', {
    app,
    scopedModeEnabled: true,
    resolveAuthorization,
    db
  }]);
});

test('fails closed if either delegated composition refuses to mount', () => {
  const common = {
    app: { post() {} },
    scopedModeEnabled: true,
    resolveAuthorization: async () => ({}),
    db: { query: async () => ({ rowCount: 0, rows: [] }) },
    executeAdjustment: async () => ({}),
    grantAchievement: async () => ({})
  };

  assert.throws(
    () => mountCustomer360FullActionEndpoints({
      ...common,
      mountCoreActionEndpoints: () => ({ mounted: false }),
      mountMetadataEndpoints: () => ({ mounted: true })
    }),
    /core action endpoints failed to mount/i
  );

  assert.throws(
    () => mountCustomer360FullActionEndpoints({
      ...common,
      mountCoreActionEndpoints: () => ({ mounted: true }),
      mountMetadataEndpoints: () => ({ mounted: false })
    }),
    /metadata endpoints failed to mount/i
  );
});

test('contract keeps metadata rollout fail-closed and dependency-free', () => {
  assert.equal(customer360FullActionEndpointsContract.failClosedWhenScopedModeDisabled, true);
  assert.equal(customer360FullActionEndpointsContract.sharedScopedRolloutBoundary, true);
  assert.equal(customer360FullActionEndpointsContract.metadataUsesCanonicalCustomerVisibilityProof, true);
  assert.equal(customer360FullActionEndpointsContract.metadataRemainsLocationScoped, true);
  assert.equal(customer360FullActionEndpointsContract.productionEnabledByDefault, false);
  assert.equal(customer360FullActionEndpointsContract.externalDependenciesAdded, false);
});
