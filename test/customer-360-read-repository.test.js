import assert from 'node:assert/strict';
import test from 'node:test';

import { createAuthorizationContext } from '../authorization-context.js';
import {
  createCustomer360ReadRepository,
  customer360ReadRepositoryContract
} from '../customer-360-read-repository.js';

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

const owner = createAuthorizationContext({
  membershipRole: 'owner',
  tenantId: 'tenant-a'
});

const staff = createAuthorizationContext({
  membershipRole: 'staff',
  tenantId: 'tenant-a',
  locationId: 'location-1'
});

const platformAdmin = createAuthorizationContext({ platformRole: 'platform_admin' });

const identityRow = {
  id: 42,
  username: 'client42',
  first_name: 'Ada',
  last_name: 'Lovelace',
  created_at: '2026-01-01T00:00:00.000Z',
  photo_url: null,
  profile_frame: 'default',
  bonus_balance: '1200',
  paid_ml_total: '3000',
  gift_ml_balance: '500'
};

const financialRow = {
  cash_paid_cents: '123456',
  bonus_credited: '5000',
  bonus_debited: '1200',
  completed_operations: '14',
  last_activity_at: '2026-09-11T18:30:00.000Z'
};

test('legacy Customer 360 keeps current global behaviour and does not run visibility precheck', async () => {
  const db = queuedDb([[identityRow], [financialRow]]);
  const repository = createCustomer360ReadRepository();

  const result = await repository.getCustomerSummary(db, 42);

  assert.equal(db.calls.length, 2);
  assert.match(db.calls[0].sql, /FROM users u/);
  assert.doesNotMatch(db.calls[1].sql, /tenant_id|location_id/);
  assert.equal(result.identity.bonusBalance, 1200);
  assert.equal(result.financial.cashPaidCents, 123456);
  assert.equal(result.financial.completedOperations, 14);
});

test('scoped owner proves customer visibility through tenant transaction footprint before identity read', async () => {
  const db = queuedDb([[{ '?column?': 1 }], [identityRow], [financialRow]]);
  const repository = createCustomer360ReadRepository({ scopedReadsEnabled: true });

  const result = await repository.getCustomerSummary(db, 42, {
    authorizationContext: owner
  });

  assert.equal(db.calls.length, 3);
  assert.match(db.calls[0].sql, /FROM transactions t/);
  assert.match(db.calls[0].sql, /t\.tenant_id = \$2/);
  assert.deepEqual(db.calls[0].params, [42, 'tenant-a']);
  assert.match(db.calls[1].sql, /FROM users u/);
  assert.match(db.calls[2].sql, /t\.tenant_id = \$2/);
  assert.deepEqual(db.calls[2].params, [42, 'tenant-a']);
  assert.equal(result.identity.id, 42);
  assert.equal(result.identity.bonusBalance, null);
  assert.equal(result.identity.giftMlBalance, null);
  assert.doesNotMatch(db.calls[1].sql, /JOIN wallets|JOIN beer_loyalty/);
});

test('scoped staff is constrained to exact tenant and location', async () => {
  const db = queuedDb([[{ ok: 1 }], [identityRow], [financialRow]]);
  const repository = createCustomer360ReadRepository({ scopedReadsEnabled: true });

  await repository.getCustomerSummary(db, 42, { authorizationContext: staff });

  assert.match(db.calls[0].sql, /t\.tenant_id = \$2 AND t\.location_id = \$3/);
  assert.deepEqual(db.calls[0].params, [42, 'tenant-a', 'location-1']);
  assert.match(db.calls[2].sql, /t\.tenant_id = \$2 AND t\.location_id = \$3/);
});

test('customer invisible in scoped tenant returns null before reading global user identity', async () => {
  const db = queuedDb([[]]);
  const repository = createCustomer360ReadRepository({ scopedReadsEnabled: true });

  const result = await repository.getCustomerSummary(db, 42, {
    authorizationContext: owner
  });

  assert.equal(result, null);
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /FROM transactions t/);
  assert.doesNotMatch(db.calls[0].sql, /FROM users u/);
});

test('staff cannot widen Customer 360 read to another location', async () => {
  const db = queuedDb([]);
  const repository = createCustomer360ReadRepository({ scopedReadsEnabled: true });

  await assert.rejects(
    repository.getCustomerSummary(db, 42, {
      authorizationContext: staff,
      tenantId: 'tenant-a',
      locationId: 'location-2'
    }),
    (error) => error?.code === 'TRANSACTION_READ_SCOPE_FORBIDDEN'
  );
  assert.equal(db.calls.length, 0);
});

test('explicit Customer 360 scope remains migration-gated while scoped reads are disabled', async () => {
  const db = queuedDb([]);
  const repository = createCustomer360ReadRepository();

  await assert.rejects(
    repository.getCustomerSummary(db, 42, {
      authorizationContext: owner
    }),
    (error) => error?.code === 'TRANSACTION_READ_SCOPE_MIGRATION_GATED'
  );
  assert.equal(db.calls.length, 0);
});

test('platform admin may intentionally use global Customer 360 read in scoped mode', async () => {
  const db = queuedDb([[identityRow], [financialRow]]);
  const repository = createCustomer360ReadRepository({ scopedReadsEnabled: true });

  const result = await repository.getCustomerSummary(db, 42, {
    authorizationContext: platformAdmin
  });

  assert.equal(db.calls.length, 2);
  assert.doesNotMatch(db.calls[1].sql, /tenant_id|location_id/);
  assert.equal(result.identity.username, 'client42');
});

test('Customer 360 rejects unsafe bigint conversion instead of silently corrupting money', async () => {
  const db = queuedDb([
    [identityRow],
    [{ ...financialRow, cash_paid_cents: '9007199254740992' }]
  ]);
  const repository = createCustomer360ReadRepository();

  await assert.rejects(
    repository.getCustomerSummary(db, 42),
    /cash_paid_cents must be a safe integer/
  );
});

test('Customer 360 contract is read-only, migration-gated and exposes no synthetic metrics', () => {
  assert.equal(customer360ReadRepositoryContract.readOnly, true);
  assert.equal(customer360ReadRepositoryContract.scopedReadsEnabledByDefault, false);
  assert.equal(customer360ReadRepositoryContract.migration, '009_spaceverse_tenant_attribution.sql');
  assert.equal(customer360ReadRepositoryContract.scopedCustomerVisibility, 'transaction-footprint-first');
  assert.equal(customer360ReadRepositoryContract.globalUserIdentityReadRequiresPriorScopedVisibility, true);
  assert.equal(customer360ReadRepositoryContract.scopedFallbackToGlobal, false);
  assert.equal(customer360ReadRepositoryContract.exposesSensitiveAuthFields, false);
  assert.equal(customer360ReadRepositoryContract.syntheticMetrics, false);
});
