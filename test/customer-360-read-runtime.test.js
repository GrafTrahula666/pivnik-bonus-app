import assert from 'node:assert/strict';
import test from 'node:test';

import { createAuthorizationContext } from '../authorization-context.js';
import {
  createCustomer360ReadRuntime,
  customer360ReadRuntimeContract
} from '../customer-360-read-runtime.js';

const owner = createAuthorizationContext({ membershipRole: 'owner', tenantId: 'tenant-a' });

function queuedDb(rowsByQuery) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const rows = rowsByQuery.shift();
      if (rows === undefined) throw new Error('Unexpected query');
      return { rows };
    }
  };
}

test('Customer 360 read runtime returns scoped summary plus scoped timeline', async () => {
  const db = queuedDb([
    [{ ok: 1 }],
    [{ id: 42, username: 'client42', first_name: 'Ada', last_name: null, created_at: '2026-01-01T00:00:00.000Z', photo_url: null, profile_frame: null, bonus_balance: null, paid_ml_total: null, gift_ml_balance: null }],
    [{ cash_paid_cents: '1000', bonus_credited: '50', bonus_debited: '10', completed_operations: '2', last_activity_at: '2026-09-10T10:00:00.000Z' }],
    [{ id: 9, client_id: 42, staff_id: 7, mode: 'accrue', status: 'completed', check_amount_cents: 1000, cash_paid_cents: 1000, bonus_earned: 50, bonus_spent: 0, reason: null, reward_code: null, created_at: '2026-09-10T10:00:00.000Z', completed_at: '2026-09-10T10:00:01.000Z', cancelled_at: null, cancelled_by: null, cancel_reason: null }]
  ]);
  let metadataFactoryCalls = 0;
  const runtime = createCustomer360ReadRuntime({
    db,
    scopedReadsEnabled: true,
    createMetadataRepository() {
      metadataFactoryCalls += 1;
      throw new Error('metadata repository must stay gated');
    }
  });

  const card = await runtime.getCustomerCard({
    customerId: 42,
    authorizationContext: owner,
    tenantId: 'tenant-a',
    timelineLimit: 10,
    timelineOffset: 0
  });

  assert.equal(card.customerId, 42);
  assert.equal(card.identity.username, 'client42');
  assert.equal(card.identity.bonusBalance, null);
  assert.equal(card.financial.cashPaidCents, 1000);
  assert.equal(card.timeline.rows.length, 1);
  assert.equal(card.timeline.rows[0].id, 9);
  assert.equal(card.metadata, null);
  assert.equal(metadataFactoryCalls, 0);
  assert.match(db.calls[0].sql, /t\.tenant_id = \$2/);
  assert.match(db.calls[2].sql, /t\.tenant_id = \$2/);
  assert.match(db.calls[3].sql, /tenant_id/);
});

test('Customer 360 metadata reads reuse the exact tenant/location/customer scope', async () => {
  const db = queuedDb([
    [{ ok: 1 }],
    [{ id: 42, username: 'client42', first_name: 'Ada', last_name: null, created_at: '2026-01-01T00:00:00.000Z', photo_url: null, profile_frame: null, bonus_balance: null, paid_ml_total: null, gift_ml_balance: null }],
    [{ cash_paid_cents: '1000', bonus_credited: '50', bonus_debited: '10', completed_operations: '2', last_activity_at: '2026-09-10T10:00:00.000Z' }],
    []
  ]);
  const metadataCalls = [];
  const runtime = createCustomer360ReadRuntime({
    db,
    scopedReadsEnabled: true,
    metadataReadsEnabled: true,
    createMetadataRepository() {
      return {
        async listEvents(input) {
          metadataCalls.push({ method: 'listEvents', input });
          return [{
            id: '9007199254740993',
            tenant_id: 'tenant-a',
            location_id: 'loc-1',
            customer_id: '42',
            actor_id: 'owner-7',
            event_type: 'note_added',
            value: 'Prefers a quiet table',
            reason: 'service context',
            request_key: 'req-1',
            created_at: '2026-09-14T06:00:00.000Z'
          }];
        },
        async listCurrentLabels(input) {
          metadataCalls.push({ method: 'listCurrentLabels', input });
          return [
            { label_kind: 'tag', value: 'vip', actor_id: 'owner-7', reason: 'manual review', created_at: '2026-09-14T06:01:00.000Z' },
            { label_kind: 'segment', value: 'returning', actor_id: 'owner-8', reason: 'manual review', created_at: '2026-09-14T06:02:00.000Z' }
          ];
        }
      };
    }
  });

  const card = await runtime.getCustomerCard({
    customerId: 42,
    authorizationContext: owner,
    tenantId: 'tenant-a',
    locationId: 'loc-1',
    metadataLimit: 20,
    metadataOffset: 5
  });

  assert.equal(metadataCalls.length, 2);
  assert.deepEqual(metadataCalls[0], {
    method: 'listEvents',
    input: { tenantId: 'tenant-a', locationId: 'loc-1', customerId: 42, limit: 20, offset: 5 }
  });
  assert.deepEqual(metadataCalls[1], {
    method: 'listCurrentLabels',
    input: { tenantId: 'tenant-a', locationId: 'loc-1', customerId: 42 }
  });
  assert.equal(card.metadata.events[0].id, '9007199254740993');
  assert.equal(card.metadata.events[0].type, 'note_added');
  assert.equal(card.metadata.tags[0].value, 'vip');
  assert.equal(card.metadata.segments[0].value, 'returning');
});

test('Customer 360 runtime stops before timeline and metadata when customer is outside scope', async () => {
  const db = queuedDb([[]]);
  let metadataRead = false;
  const runtime = createCustomer360ReadRuntime({
    db,
    scopedReadsEnabled: true,
    metadataReadsEnabled: true,
    createMetadataRepository() {
      return {
        async listEvents() {
          metadataRead = true;
          return [];
        },
        async listCurrentLabels() {
          metadataRead = true;
          return [];
        }
      };
    }
  });

  const card = await runtime.getCustomerCard({ customerId: 42, authorizationContext: owner, tenantId: 'tenant-a' });

  assert.equal(card, null);
  assert.equal(db.calls.length, 1);
  assert.equal(metadataRead, false);
  assert.match(db.calls[0].sql, /FROM transactions t/);
});

test('Customer 360 runtime contract remains read-only, synthetic-free and metadata-gated', () => {
  assert.equal(customer360ReadRuntimeContract.readOnly, true);
  assert.equal(customer360ReadRuntimeContract.reusesCanonicalSummaryRepository, true);
  assert.equal(customer360ReadRuntimeContract.reusesCanonicalTimelineRepository, true);
  assert.equal(customer360ReadRuntimeContract.reusesCanonicalMetadataRepository, true);
  assert.equal(customer360ReadRuntimeContract.metadataMigration, '010_spaceverse_customer_metadata.sql');
  assert.equal(customer360ReadRuntimeContract.metadataFailClosedByDefault, true);
  assert.equal(customer360ReadRuntimeContract.scopedFallbackToGlobal, false);
  assert.equal(customer360ReadRuntimeContract.syntheticMetrics, false);
  assert.equal(customer360ReadRuntimeContract.externalDependenciesAdded, false);
});
