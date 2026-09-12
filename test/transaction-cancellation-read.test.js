import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTransactionCancellationRead,
  transactionCancellationReadContract
} from '../transaction-cancellation-read.js';

function fakeDb(rows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: rows.length, rows };
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

test('legacy cancellation replay preserves the current global lookup shape', async () => {
  const db = fakeDb([{ id: 7 }]);
  const reader = createTransactionCancellationRead();

  const row = await reader.findReplayForUpdate(db, 'cancel:7');

  assert.equal(row.id, 7);
  assert.deepEqual(db.calls[0].params, ['cancel:7']);
  assert.equal(
    db.calls[0].sql,
    'SELECT t.* FROM transactions t WHERE t.cancel_request_key = $1 FOR UPDATE'
  );
});

test('legacy completed lookup preserves global id/status locking semantics', async () => {
  const db = fakeDb([{ id: 8, status: 'completed' }]);
  const reader = createTransactionCancellationRead();

  await reader.findCompletedByIdForUpdate(db, 8);

  assert.deepEqual(db.calls[0].params, ['8']);
  assert.equal(
    db.calls[0].sql,
    "SELECT t.* FROM transactions t WHERE t.id = $1 AND t.status = 'completed' FOR UPDATE"
  );
});

test('scoped owner replay lookup is tenant-bound', async () => {
  const db = fakeDb([]);
  const reader = createTransactionCancellationRead({ scopedReadsEnabled: true });

  await reader.findReplayForUpdate(db, 'cancel:9', {
    authorizationContext: ownerContext
  });

  assert.deepEqual(db.calls[0].params, ['cancel:9', 'tenant-a']);
  assert.equal(
    db.calls[0].sql,
    'SELECT t.* FROM transactions t WHERE t.cancel_request_key = $1 AND t.tenant_id = $2 FOR UPDATE'
  );
});

test('scoped owner may deliberately narrow cancellation lookup to one authorized location', async () => {
  const db = fakeDb([]);
  const reader = createTransactionCancellationRead({ scopedReadsEnabled: true });

  await reader.findCompletedByIdForUpdate(db, '10', {
    authorizationContext: ownerContext,
    tenantId: 'tenant-a',
    locationId: 'location-b'
  });

  assert.deepEqual(db.calls[0].params, ['10', 'tenant-a', 'location-b']);
  assert.equal(
    db.calls[0].sql,
    "SELECT t.* FROM transactions t WHERE t.id = $1 AND t.status = 'completed' AND t.tenant_id = $2 AND t.location_id = $3 FOR UPDATE"
  );
});

test('scoped staff cancellation lookup is bound to its exact tenant/location', async () => {
  const db = fakeDb([]);
  const reader = createTransactionCancellationRead({ scopedReadsEnabled: true });

  await reader.findCompletedByIdForUpdate(db, '11', {
    authorizationContext: staffContext
  });

  assert.deepEqual(db.calls[0].params, ['11', 'tenant-a', 'location-a']);
  assert.match(db.calls[0].sql, /t\.tenant_id = \$2 AND t\.location_id = \$3/);
});

test('staff cannot widen cancellation lookup to another location and no SQL runs', async () => {
  const db = fakeDb([]);
  const reader = createTransactionCancellationRead({ scopedReadsEnabled: true });

  await assert.rejects(
    reader.findReplayForUpdate(db, 'cancel:12', {
      authorizationContext: staffContext,
      tenantId: 'tenant-a',
      locationId: 'location-b'
    }),
    (error) => error?.code === 'TRANSACTION_READ_SCOPE_FORBIDDEN'
  );
  assert.equal(db.calls.length, 0);
});

test('scoped cancellation options are rejected while migration gate is disabled', async () => {
  const db = fakeDb([]);
  const reader = createTransactionCancellationRead();

  await assert.rejects(
    reader.findReplayForUpdate(db, 'cancel:13', {
      authorizationContext: ownerContext
    }),
    (error) => error?.code === 'TRANSACTION_READ_SCOPE_MIGRATION_GATED'
  );
  assert.equal(db.calls.length, 0);
});

test('invalid cancellation lookup keys fail before SQL', async () => {
  const db = fakeDb([]);
  const reader = createTransactionCancellationRead();

  await assert.rejects(reader.findReplayForUpdate(db, '   '), /requestKey is required/);
  await assert.rejects(reader.findCompletedByIdForUpdate(db, null), /transactionId is required/);
  assert.equal(db.calls.length, 0);
});

test('cancellation read contract remains migration-gated and fail-closed', () => {
  assert.equal(transactionCancellationReadContract.defaultMode, 'legacy');
  assert.equal(transactionCancellationReadContract.scopedReadsEnabledByDefault, false);
  assert.equal(transactionCancellationReadContract.migration, '009_spaceverse_tenant_attribution.sql');
  assert.equal(transactionCancellationReadContract.replayLookupScoped, true);
  assert.equal(transactionCancellationReadContract.completedTransactionLookupScoped, true);
  assert.equal(transactionCancellationReadContract.scopedFallbackToGlobal, false);
});
