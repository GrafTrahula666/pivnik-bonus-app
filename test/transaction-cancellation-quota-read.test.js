import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTransactionCancellationQuotaRead,
  transactionCancellationQuotaReadContract
} from '../transaction-cancellation-quota-read.js';

function fakeDb(rows = [{ count: 0 }]) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows };
    }
  };
}

const ownerContext = Object.freeze({
  platformRole: null,
  membershipRole: 'owner',
  tenantId: 'tenant-a',
  locationId: null,
  tenantIds: ['tenant-a'],
  locationIds: ['location-a', 'location-b']
});

const staffContext = Object.freeze({
  platformRole: null,
  membershipRole: 'staff',
  tenantId: 'tenant-a',
  locationId: 'location-a',
  tenantIds: ['tenant-a'],
  locationIds: ['location-a']
});

test('legacy cancellation quota count preserves current global transaction predicate', async () => {
  const db = fakeDb([{ count: 2 }]);
  const reader = createTransactionCancellationQuotaRead();
  const from = new Date('2026-09-12T01:00:00.000Z');

  const count = await reader.countCancelledSince(db, 42, from);

  assert.equal(count, 2);
  assert.deepEqual(db.calls[0].params, ['42', from]);
  assert.equal(
    db.calls[0].sql,
    `SELECT COUNT(*)::int AS count
         FROM transactions t
         WHERE t.cancelled_by = $1 AND t.cancelled_at >= $2`
  );
});

test('scoped owner cancellation quota count is tenant-bound', async () => {
  const db = fakeDb([{ count: 1 }]);
  const reader = createTransactionCancellationQuotaRead({ scopedReadsEnabled: true });
  const from = new Date('2026-09-12T01:00:00.000Z');

  await reader.countCancelledSince(db, 42, from, { authorizationContext: ownerContext });

  assert.deepEqual(db.calls[0].params, ['42', from, 'tenant-a']);
  assert.match(db.calls[0].sql, /t\.tenant_id = \$3$/);
});

test('scoped owner may narrow cancellation quota count to one location', async () => {
  const db = fakeDb([{ count: 1 }]);
  const reader = createTransactionCancellationQuotaRead({ scopedReadsEnabled: true });
  const from = new Date('2026-09-12T01:00:00.000Z');

  await reader.countCancelledSince(db, 42, from, {
    authorizationContext: ownerContext,
    tenantId: 'tenant-a',
    locationId: 'location-b'
  });

  assert.deepEqual(db.calls[0].params, ['42', from, 'tenant-a', 'location-b']);
  assert.match(db.calls[0].sql, /t\.tenant_id = \$3 AND t\.location_id = \$4$/);
});

test('scoped staff cancellation quota count is bound to exact tenant/location', async () => {
  const db = fakeDb([{ count: 3 }]);
  const reader = createTransactionCancellationQuotaRead({ scopedReadsEnabled: true });
  const from = new Date('2026-09-12T01:00:00.000Z');

  const count = await reader.countCancelledSince(db, 77, from, {
    authorizationContext: staffContext
  });

  assert.equal(count, 3);
  assert.deepEqual(db.calls[0].params, ['77', from, 'tenant-a', 'location-a']);
  assert.match(db.calls[0].sql, /t\.tenant_id = \$3 AND t\.location_id = \$4$/);
});

test('staff cannot widen quota count to another location and no SQL runs', async () => {
  const db = fakeDb();
  const reader = createTransactionCancellationQuotaRead({ scopedReadsEnabled: true });

  await assert.rejects(
    reader.countCancelledSince(db, 77, new Date(), {
      authorizationContext: staffContext,
      tenantId: 'tenant-a',
      locationId: 'location-b'
    }),
    (error) => error?.code === 'TRANSACTION_READ_SCOPE_FORBIDDEN'
  );
  assert.equal(db.calls.length, 0);
});

test('scoped quota options are rejected while migration gate is disabled', async () => {
  const db = fakeDb();
  const reader = createTransactionCancellationQuotaRead();

  await assert.rejects(
    reader.countCancelledSince(db, 42, new Date(), { authorizationContext: ownerContext }),
    (error) => error?.code === 'TRANSACTION_READ_SCOPE_MIGRATION_GATED'
  );
  assert.equal(db.calls.length, 0);
});

test('invalid quota inputs fail before SQL', async () => {
  const db = fakeDb();
  const reader = createTransactionCancellationQuotaRead();

  await assert.rejects(reader.countCancelledSince(db, ' ', new Date()), /staffId is required/);
  await assert.rejects(reader.countCancelledSince(db, 42, 'not-a-date'), /countFrom must be a valid date/);
  assert.equal(db.calls.length, 0);
});

test('invalid database cancellation count is rejected', async () => {
  const db = fakeDb([{ count: -1 }]);
  const reader = createTransactionCancellationQuotaRead();

  await assert.rejects(
    reader.countCancelledSince(db, 42, new Date()),
    /Cancellation count must be a non-negative safe integer/
  );
});

test('quota read contract explicitly leaves shift/reset scoping unresolved', () => {
  assert.equal(transactionCancellationQuotaReadContract.defaultMode, 'legacy');
  assert.equal(transactionCancellationQuotaReadContract.scopedReadsEnabledByDefault, false);
  assert.equal(transactionCancellationQuotaReadContract.migration, '009_spaceverse_tenant_attribution.sql');
  assert.equal(transactionCancellationQuotaReadContract.cancellationCountScoped, true);
  assert.equal(transactionCancellationQuotaReadContract.shiftScopeHandled, false);
  assert.equal(transactionCancellationQuotaReadContract.resetScopeHandled, false);
  assert.equal(transactionCancellationQuotaReadContract.scopedFallbackToGlobal, false);
});
