import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { assertLegacyApiRequest, assertLegacyScopeBody } from '../legacy-api-boundary.js';
import { createTransactionReadRepository } from '../transaction-read-repository.js';
import { createTransactionCancellationRead } from '../transaction-cancellation-read.js';
import { createTransactionCancellationQuotaRead } from '../transaction-cancellation-quota-read.js';
import { createTransactionRollingSpendRead } from '../transaction-rolling-spend-read.js';

const owner = { membershipRole: 'owner', tenantId: 'a' };
const staff = { membershipRole: 'staff', tenantId: 'a', locationId: 'x' };

test('legacy APIs reject all scoped markers and all legacy routes after explicit rollout', () => {
  assert.doesNotThrow(() => assertLegacyApiRequest({ url: '/api/admin/users' }));
  for (const req of [
    { url: '/api/admin/users?tenantId=a' }, { url: '/api/admin/users?tenant_id=' },
    { url: '/api/admin/users', headers: { 'x-location-id': 'x' } },
    { url: '/api/admin/users/1/adjust', body: { tenantId: 'b' } },
    { url: '/api/staff/history', spaceverseAuthorization: { mode: 'scoped' } }
  ]) assert.throws(() => assertLegacyApiRequest(req), /tenant|Scoped|legacy/);
  assert.throws(() => assertLegacyScopeBody({ authorizationContext: { role: 'admin' } }));
  for (const path of ['admin/users','admin/transactions','staff/history','transactions','leaderboard','achievements','me','shop','wheel']) {
    assert.throws(() => assertLegacyApiRequest({ url: `/api/${path}` }, { scopedModeEnabled: true }), /legacy API/);
  }
});

test('SQL readers isolate the same customer across tenants/locations, including replay, quota and unknown rows', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE transactions (
      id BIGSERIAL PRIMARY KEY, client_id BIGINT, staff_id BIGINT, tenant_id TEXT, location_id TEXT,
      request_key TEXT, cancel_request_key TEXT, mode TEXT DEFAULT 'accrue', status TEXT DEFAULT 'completed',
      check_amount_cents BIGINT DEFAULT 100, cash_paid_cents BIGINT DEFAULT 100,
      bonus_earned BIGINT DEFAULT 5, bonus_spent BIGINT DEFAULT 0, beer_ml BIGINT DEFAULT 0,
      reason TEXT, reward_code TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), completed_at TIMESTAMPTZ,
      cancelled_by BIGINT DEFAULT 10, cancelled_at TIMESTAMPTZ DEFAULT NOW(), cancel_reason TEXT);
      INSERT INTO transactions (client_id, tenant_id, location_id, request_key, cancel_request_key) VALUES
      (1,'a','x','ax','cancel-ax'),(1,'a','y','ay','cancel-ay'),(1,'b','x','bx','cancel-bx'),(1,NULL,NULL,'old','cancel-old');`);
    const read = createTransactionReadRepository({ query: db.query.bind(db), scopedReadsEnabled: true });
    const a = { authorizationContext: owner };
    const x = { authorizationContext: staff };
    const global = { authorizationContext: { platformRole: 'platform_admin' } };
    assert.equal((await read.list(a, { customerId: '1' })).rows.length, 2);
    assert.equal((await read.list(x, { customerId: '1' })).rows.length, 1);
    assert.equal((await read.list(global)).rows.length, 4);
    assert.equal(Number((await read.summary(x, { customerId: '1' })).spent_cents), 100);
    assert.equal(await read.findByRequestKeyForUpdate('bx', a), null);
    assert.equal(await read.findByRequestKeyForUpdate('old', a), null);
    const first = await read.list(a, { limit: 1 });
    assert.equal(first.hasMore, true);
    assert.notEqual(first.rows[0].id, (await read.list(a, { limit: 1, offset: 1 })).rows[0].id);
    const cancel = createTransactionCancellationRead({ scopedReadsEnabled: true });
    assert.equal(await cancel.findReplayForUpdate(db, 'cancel-bx', a), null);
    assert.equal(await cancel.findCompletedByIdForUpdate(db, '2', x), null);
    const quota = createTransactionCancellationQuotaRead({ scopedReadsEnabled: true });
    assert.equal(await quota.countCancelledSince(db, '10', new Date(0), x), 1);
    const spend = createTransactionRollingSpendRead({ scopedReadsEnabled: true });
    assert.equal(await spend.getRollingSpend(db, '1', x), 100);
    await assert.rejects(read.list({ ...a, tenantId: 'b' }), { code: 'TRANSACTION_READ_SCOPE_FORBIDDEN' });
    await assert.rejects(read.list({ ...x, tenantId: 'a', locationId: 'y' }), { code: 'TRANSACTION_READ_SCOPE_FORBIDDEN' });
    assert.equal((await read.list({ authorizationContext: { membershipRole: 'owner', tenantId: "a' OR TRUE--" } })).rows.length, 0);
    await assert.rejects(read.list(), /authorizationContext/);
    const disabled = createTransactionReadRepository({ query: () => assert.fail('no SQL before enablement') });
    await assert.rejects(disabled.list(a), { code: 'TRANSACTION_READ_SCOPE_MIGRATION_GATED' });
  } finally { await db.close(); }
});
