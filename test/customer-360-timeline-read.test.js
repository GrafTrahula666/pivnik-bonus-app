import assert from 'node:assert/strict';
import test from 'node:test';

import { createAuthorizationContext } from '../authorization-context.js';
import {
  createCustomer360TimelineRead,
  customer360TimelineReadContract
} from '../customer-360-timeline-read.js';

function queryRecorder(rows) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows };
    }
  };
}

const owner = createAuthorizationContext({ membershipRole: 'owner', tenantId: 'tenant-a' });
const staff = createAuthorizationContext({
  membershipRole: 'staff',
  tenantId: 'tenant-a',
  locationId: 'location-1'
});

const timelineRows = [
  {
    id: '11',
    client_id: '42',
    staff_id: '7',
    mode: 'redeem',
    status: 'completed',
    check_amount_cents: '5000',
    cash_paid_cents: '4300',
    bonus_earned: '215',
    bonus_spent: '700',
    reason: null,
    reward_code: null,
    created_at: '2026-09-12T05:00:00.000Z',
    completed_at: '2026-09-12T05:00:01.000Z',
    cancelled_at: null,
    cancelled_by: null,
    cancel_reason: null
  },
  {
    id: '10',
    client_id: '42',
    staff_id: null,
    mode: 'achievement',
    status: 'completed',
    check_amount_cents: '0',
    cash_paid_cents: '0',
    bonus_earned: '100',
    bonus_spent: '0',
    reason: 'achievement reward',
    reward_code: 'raise-shields',
    created_at: '2026-09-11T05:00:00.000Z',
    completed_at: '2026-09-11T05:00:00.000Z',
    cancelled_at: null,
    cancelled_by: null,
    cancel_reason: null
  }
];

test('legacy Customer 360 timeline reuses transaction repository and preserves bounded pagination', async () => {
  const db = queryRecorder(timelineRows);
  const timeline = createCustomer360TimelineRead({ query: db.query });

  const result = await timeline.listCustomerTimeline(42, {}, { limit: 2, offset: 0 });

  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /t\.client_id = \$1/);
  assert.doesNotMatch(db.calls[0].sql, /tenant_id|location_id/);
  assert.match(db.calls[0].sql, /ORDER BY t\.created_at DESC, t\.id DESC/);
  assert.deepEqual(db.calls[0].params, ['42', 3, 0]);
  assert.equal(result.rows[0].cashPaidCents, 4300);
  assert.equal(result.rows[0].bonusSpent, 700);
  assert.equal(result.rows[1].rewardCode, 'raise-shields');
  assert.equal(result.hasMore, false);
});

test('owner Customer 360 timeline is tenant-scoped', async () => {
  const db = queryRecorder(timelineRows);
  const timeline = createCustomer360TimelineRead({ query: db.query, scopedReadsEnabled: true });

  await timeline.listCustomerTimeline(42, { authorizationContext: owner }, { limit: 20, offset: 0 });

  assert.match(db.calls[0].sql, /t\.tenant_id = \$1/);
  assert.match(db.calls[0].sql, /t\.client_id = \$2/);
  assert.deepEqual(db.calls[0].params, ['tenant-a', '42', 21, 0]);
});

test('staff Customer 360 timeline is constrained to exact tenant/location', async () => {
  const db = queryRecorder(timelineRows);
  const timeline = createCustomer360TimelineRead({ query: db.query, scopedReadsEnabled: true });

  await timeline.listCustomerTimeline(42, { authorizationContext: staff }, { limit: 20, offset: 0 });

  assert.match(db.calls[0].sql, /t\.tenant_id = \$1 AND t\.location_id = \$2/);
  assert.match(db.calls[0].sql, /t\.client_id = \$3/);
  assert.deepEqual(db.calls[0].params, ['tenant-a', 'location-1', '42', 21, 0]);
});

test('staff cannot widen Customer 360 timeline to another location', async () => {
  const db = queryRecorder([]);
  const timeline = createCustomer360TimelineRead({ query: db.query, scopedReadsEnabled: true });

  await assert.rejects(
    timeline.listCustomerTimeline(42, {
      authorizationContext: staff,
      tenantId: 'tenant-a',
      locationId: 'location-2'
    }),
    (error) => error?.code === 'TRANSACTION_READ_SCOPE_FORBIDDEN'
  );
  assert.equal(db.calls.length, 0);
});

test('explicit scoped Customer 360 timeline remains migration-gated by default', async () => {
  const db = queryRecorder([]);
  const timeline = createCustomer360TimelineRead({ query: db.query });

  await assert.rejects(
    timeline.listCustomerTimeline(42, { authorizationContext: owner }),
    (error) => error?.code === 'TRANSACTION_READ_SCOPE_MIGRATION_GATED'
  );
  assert.equal(db.calls.length, 0);
});

test('Customer 360 timeline rejects invalid pagination before SQL', async () => {
  const db = queryRecorder([]);
  const timeline = createCustomer360TimelineRead({ query: db.query });

  await assert.rejects(
    timeline.listCustomerTimeline(42, {}, { limit: 101, offset: 0 }),
    /Некорректная страница/
  );
  assert.equal(db.calls.length, 0);
});

test('Customer 360 timeline rejects unsafe financial integer conversion', async () => {
  const db = queryRecorder([{ ...timelineRows[0], cash_paid_cents: '9007199254740992' }]);
  const timeline = createCustomer360TimelineRead({ query: db.query });

  await assert.rejects(
    timeline.listCustomerTimeline(42),
    /transaction.cash_paid_cents must be a safe integer/
  );
});

test('Customer 360 timeline contract is read-only and does not synthesize events', () => {
  assert.equal(customer360TimelineReadContract.readOnly, true);
  assert.equal(customer360TimelineReadContract.source, 'transaction-read-repository');
  assert.equal(customer360TimelineReadContract.scopedReadsEnabledByDefault, false);
  assert.equal(customer360TimelineReadContract.maxPageSize, 100);
  assert.equal(customer360TimelineReadContract.scopedFallbackToGlobal, false);
  assert.equal(customer360TimelineReadContract.syntheticEvents, false);
});
