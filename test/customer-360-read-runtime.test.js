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
  const runtime = createCustomer360ReadRuntime({ db, scopedReadsEnabled: true });

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
  assert.match(db.calls[0].sql, /t\.tenant_id = \$2/);
  assert.match(db.calls[2].sql, /t\.tenant_id = \$2/);
  assert.match(db.calls[3].sql, /tenant_id/);
});

test('Customer 360 runtime stops before timeline when customer is outside scope', async () => {
  const db = queuedDb([[]]);
  const runtime = createCustomer360ReadRuntime({ db, scopedReadsEnabled: true });

  const card = await runtime.getCustomerCard({ customerId: 42, authorizationContext: owner, tenantId: 'tenant-a' });

  assert.equal(card, null);
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /FROM transactions t/);
});

test('Customer 360 runtime contract remains read-only and synthetic-free', () => {
  assert.equal(customer360ReadRuntimeContract.readOnly, true);
  assert.equal(customer360ReadRuntimeContract.reusesCanonicalSummaryRepository, true);
  assert.equal(customer360ReadRuntimeContract.reusesCanonicalTimelineRepository, true);
  assert.equal(customer360ReadRuntimeContract.scopedFallbackToGlobal, false);
  assert.equal(customer360ReadRuntimeContract.syntheticMetrics, false);
  assert.equal(customer360ReadRuntimeContract.externalDependenciesAdded, false);
});
