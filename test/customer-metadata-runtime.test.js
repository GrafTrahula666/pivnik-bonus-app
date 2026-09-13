import assert from 'node:assert/strict';
import test from 'node:test';

import { createAuthorizationContext } from '../authorization-context.js';
import {
  createCustomerMetadataRuntime,
  customerMetadataRuntimeContract
} from '../customer-metadata-runtime.js';

const owner = createAuthorizationContext({ membershipRole: 'owner', tenantId: 'tenant-a' });
const staff = createAuthorizationContext({ membershipRole: 'staff', tenantId: 'tenant-a', locationId: 'location-1' });

function base(overrides = {}) {
  return {
    context: owner,
    tenantId: 'tenant-a',
    locationId: 'location-1',
    actorId: 'owner-1',
    customerId: '42',
    tag: 'vip',
    reason: 'Manual CRM correction',
    requestKey: 'metadata-runtime-1',
    ...overrides
  };
}

function createHarness({ visible = true, context = owner } = {}) {
  const calls = [];
  const db = { query: async () => ({ rows: [] }) };
  const runtime = createCustomerMetadataRuntime({
    db,
    scopedReadsEnabled: true,
    createReadRepository(options) {
      assert.equal(options.scopedReadsEnabled, true);
      return {
        async isCustomerVisible(receivedDb, customerId, scope) {
          calls.push(['visible', receivedDb, customerId, scope]);
          return visible;
        }
      };
    },
    createMetadataRepository({ query }) {
      assert.equal(typeof query, 'function');
      return {
        async appendEvent(command) {
          calls.push(['append', command]);
          return command;
        }
      };
    }
  });
  return { runtime, calls, db, context };
}

test('runtime proves canonical Customer 360 visibility before append-only metadata persistence', async () => {
  const { runtime, calls, db } = createHarness();

  const result = await runtime.addTag(base());

  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], 'visible');
  assert.equal(calls[0][1], db);
  assert.equal(calls[0][2], '42');
  assert.equal(calls[0][3].tenantId, 'tenant-a');
  assert.equal(calls[0][3].locationId, 'location-1');
  assert.equal(calls[1][0], 'append');
  assert.equal(calls[1][1].eventType, 'tag_added');
  assert.equal(result.customerId, '42');
});

test('invisible customer is denied before metadata persistence', async () => {
  const { runtime, calls } = createHarness({ visible: false });

  await assert.rejects(
    runtime.addTag(base()),
    (error) => error?.code === 'customer_scope_denied'
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'visible');
});

test('RBAC denial happens before Customer 360 visibility lookup', async () => {
  const { runtime, calls } = createHarness();

  await assert.rejects(
    runtime.addTag(base({
      context: staff,
      tenantId: 'tenant-a',
      locationId: 'location-2',
      actorId: 'staff-1',
      requestKey: 'metadata-runtime-cross-location'
    })),
    (error) => error?.code === 'scope_denied'
  );

  assert.deepEqual(calls, []);
});

test('cross-tenant owner request is denied before visibility or persistence', async () => {
  const { runtime, calls } = createHarness();

  await assert.rejects(
    runtime.addSegment(base({
      tenantId: 'tenant-b',
      segment: 'at-risk',
      requestKey: 'metadata-runtime-cross-tenant'
    })),
    (error) => error?.code === 'scope_denied'
  );

  assert.deepEqual(calls, []);
});

test('runtime exposes all append-only Customer 360 metadata mutations', async () => {
  const { runtime, calls } = createHarness();
  const common = {
    context: owner,
    tenantId: 'tenant-a',
    locationId: 'location-1',
    actorId: 'owner-1',
    customerId: '42',
    reason: 'CRM maintenance'
  };

  await runtime.addNote({ ...common, note: 'Prefers quiet table', requestKey: 'meta-note' });
  await runtime.addTag({ ...common, tag: 'vip', requestKey: 'meta-tag-add' });
  await runtime.removeTag({ ...common, tag: 'vip', requestKey: 'meta-tag-remove' });
  await runtime.addSegment({ ...common, segment: 'returning', requestKey: 'meta-segment-add' });
  await runtime.removeSegment({ ...common, segment: 'returning', requestKey: 'meta-segment-remove' });

  const eventTypes = calls.filter(([type]) => type === 'append').map(([, command]) => command.eventType);
  assert.deepEqual(eventTypes, [
    'note_added',
    'tag_added',
    'tag_removed',
    'segment_added',
    'segment_removed'
  ]);
});

test('runtime fails fast on incomplete composition', () => {
  assert.throws(() => createCustomerMetadataRuntime(), /db.query is required/);
  assert.throws(
    () => createCustomerMetadataRuntime({
      db: { query() {} },
      createReadRepository() { return {}; }
    }),
    /must expose isCustomerVisible/
  );
  assert.throws(
    () => createCustomerMetadataRuntime({
      db: { query() {} },
      createReadRepository() { return { isCustomerVisible() { return true; } }; },
      createMetadataRepository() { return {}; }
    }),
    /must expose appendEvent/
  );
});

test('runtime contract stays fail-closed and production-safe', () => {
  assert.equal(customerMetadataRuntimeContract.visibilityBoundary, 'customer-360-read-repository');
  assert.equal(customerMetadataRuntimeContract.persistenceBoundary, 'customer-metadata-repository');
  assert.equal(customerMetadataRuntimeContract.appendOnly, true);
  assert.equal(customerMetadataRuntimeContract.authorizationBeforeVisibilityProof, true);
  assert.equal(customerMetadataRuntimeContract.scopedFallbackToGlobal, false);
  assert.equal(customerMetadataRuntimeContract.arbitraryGlobalCustomerMutationAllowed, false);
  assert.equal(customerMetadataRuntimeContract.duplicatesTenantOwnershipLogic, false);
  assert.equal(customerMetadataRuntimeContract.productionRouteWired, false);
  assert.equal(customerMetadataRuntimeContract.migrationApplied, false);
  assert.equal(customerMetadataRuntimeContract.externalDependenciesAdded, false);
});
