import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTransactionRollingSpendRead,
  transactionRollingSpendReadContract
} from '../transaction-rolling-spend-read.js';

function fakeDb(rows = [{ spend: 0 }]) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows };
    }
  };
}

const platformAdminContext = Object.freeze({
  platformRole: 'platform_admin',
  membershipRole: null,
  tenantId: null,
  locationId: null,
  tenantIds: ['tenant-a'],
  locationIds: ['location-a', 'location-b']
});

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

test('legacy rolling spend preserves current server.js SQL shape', async () => {
  const db = fakeDb([{ spend: '12345' }]);
  const reader = createTransactionRollingSpendRead();

  const spend = await reader.getRollingSpend(db, 42);

  assert.equal(spend, 12345);
  assert.deepEqual(db.calls[0].params, ['42']);
  assert.equal(
    db.calls[0].sql,
    `SELECT COALESCE(SUM(cash_paid_cents), 0)::bigint AS spend
     FROM transactions
     WHERE client_id = $1
       AND status = 'completed'
       AND mode IN ('accrue','redeem')
       AND created_at >= NOW() - INTERVAL '12 months'`
  );
});

test('platform admin may keep rolling spend global in scoped mode', async () => {
  const db = fakeDb([{ spend: 100 }]);
  const reader = createTransactionRollingSpendRead({ scopedReadsEnabled: true });

  await reader.getRollingSpend(db, 42, { authorizationContext: platformAdminContext });

  assert.deepEqual(db.calls[0].params, ['42']);
  assert.doesNotMatch(db.calls[0].sql, /tenant_id|location_id/);
});

test('owner rolling spend is tenant-bound', async () => {
  const db = fakeDb([{ spend: 200 }]);
  const reader = createTransactionRollingSpendRead({ scopedReadsEnabled: true });

  await reader.getRollingSpend(db, 42, { authorizationContext: ownerContext });

  assert.deepEqual(db.calls[0].params, ['42', 'tenant-a']);
  assert.match(db.calls[0].sql, /t\.tenant_id = \$2$/);
});

test('owner may narrow rolling spend to one location', async () => {
  const db = fakeDb([{ spend: 300 }]);
  const reader = createTransactionRollingSpendRead({ scopedReadsEnabled: true });

  await reader.getRollingSpend(db, 42, {
    authorizationContext: ownerContext,
    tenantId: 'tenant-a',
    locationId: 'location-b'
  });

  assert.deepEqual(db.calls[0].params, ['42', 'tenant-a', 'location-b']);
  assert.match(db.calls[0].sql, /t\.tenant_id = \$2 AND t\.location_id = \$3$/);
});

test('staff rolling spend is bound to exact tenant/location', async () => {
  const db = fakeDb([{ spend: 400 }]);
  const reader = createTransactionRollingSpendRead({ scopedReadsEnabled: true });

  const spend = await reader.getRollingSpend(db, 77, { authorizationContext: staffContext });

  assert.equal(spend, 400);
  assert.deepEqual(db.calls[0].params, ['77', 'tenant-a', 'location-a']);
  assert.match(db.calls[0].sql, /t\.tenant_id = \$2 AND t\.location_id = \$3$/);
});

test('staff cannot widen rolling spend to another location and no SQL runs', async () => {
  const db = fakeDb();
  const reader = createTransactionRollingSpendRead({ scopedReadsEnabled: true });

  await assert.rejects(
    reader.getRollingSpend(db, 77, {
      authorizationContext: staffContext,
      tenantId: 'tenant-a',
      locationId: 'location-b'
    }),
    (error) => error?.code === 'TRANSACTION_READ_SCOPE_FORBIDDEN'
  );
  assert.equal(db.calls.length, 0);
});

test('scoped rolling spend options are migration-gated by default', async () => {
  const db = fakeDb();
  const reader = createTransactionRollingSpendRead();

  await assert.rejects(
    reader.getRollingSpend(db, 42, { authorizationContext: ownerContext }),
    (error) => error?.code === 'TRANSACTION_READ_SCOPE_MIGRATION_GATED'
  );
  assert.equal(db.calls.length, 0);
});

test('invalid user id fails before SQL', async () => {
  const db = fakeDb();
  const reader = createTransactionRollingSpendRead();

  await assert.rejects(reader.getRollingSpend(db, ' '), /userId is required/);
  assert.equal(db.calls.length, 0);
});

test('unsafe or negative rolling spend is rejected', async () => {
  const reader = createTransactionRollingSpendRead();

  await assert.rejects(
    reader.getRollingSpend(fakeDb([{ spend: '-1' }]), 42),
    /Rolling spend must be a non-negative safe integer/
  );
  await assert.rejects(
    reader.getRollingSpend(fakeDb([{ spend: '9007199254740992' }]), 42),
    /Rolling spend must be a non-negative safe integer/
  );
});

test('rolling spend contract freezes existing loyalty semantics', () => {
  assert.equal(transactionRollingSpendReadContract.defaultMode, 'legacy');
  assert.equal(transactionRollingSpendReadContract.scopedReadsEnabledByDefault, false);
  assert.equal(transactionRollingSpendReadContract.migration, '009_spaceverse_tenant_attribution.sql');
  assert.equal(transactionRollingSpendReadContract.period, '12 months');
  assert.deepEqual(transactionRollingSpendReadContract.statuses, ['completed']);
  assert.deepEqual(transactionRollingSpendReadContract.modes, ['accrue', 'redeem']);
  assert.equal(transactionRollingSpendReadContract.measure, 'cash_paid_cents');
  assert.equal(transactionRollingSpendReadContract.scopedFallbackToGlobal, false);
});
