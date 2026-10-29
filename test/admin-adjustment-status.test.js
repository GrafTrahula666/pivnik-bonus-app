import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createAuthorizationContext } from '../authorization-context.js';
import { createAdminAdjustmentStatusReader, adminAdjustmentStatusContract } from '../admin-adjustment-status.js';

const owner = createAuthorizationContext({ membershipRole: 'owner', tenantId: 'tenant-a' });
const request = () => ({ authorizationContext: owner, authenticatedActorId: '10',
  tenantId: 'tenant-a', locationId: 'location-a', clientId: '20',
  command: { amount: 25, reason: 'Fixture correction', requestKey: 'status-fixture-key' } });
const row = () => ({ id: '1', tenant_id: 'tenant-a', location_id: 'location-a',
  client_id: '20', staff_id: '10', request_key: 'status-fixture-key', mode: 'adjustment',
  status: 'completed', bonus_earned: '25', bonus_spent: '0', balance_after: '125', reason: 'Fixture correction' });
const reader = (rows, options = {}) => createAdminAdjustmentStatusReader({ scopedReadsEnabled: true, query: async () => ({ rows }), ...options });

test('status reader is disabled by default and has no legacy fallback', async () => {
  let calls = 0;
  await assert.rejects(createAdminAdjustmentStatusReader({ query: async () => { calls++; } })(request()), { code: 'ADJUSTMENT_STATUS_UNAVAILABLE' });
  assert.equal(calls, 0);
  assert.equal(adminAdjustmentStatusContract.productionWiringEnabled, false);
  assert.equal(adminAdjustmentStatusContract.missingRowProvesNonCommit, false);
  assert.throws(() => createAdminAdjustmentStatusReader({ query() {}, scopedReadsEnabled: 'true' }), TypeError);
});

test('status denies staff, foreign owner and legacy admin before SQL', async () => {
  let calls = 0;
  const read = reader([], { query: async () => { calls++; } });
  for (const authorizationContext of [null, { role: 'admin' },
    createAuthorizationContext({ membershipRole: 'owner', tenantId: 'tenant-b' }),
    createAuthorizationContext({ membershipRole: 'staff', tenantId: 'tenant-a', locationId: 'location-a' })]) {
    await assert.rejects(read({ ...request(), authorizationContext }), { code: 'ADJUSTMENT_STATUS_FORBIDDEN' });
  }
  assert.equal(calls, 0);
});

test('status validates scope, session actor, client and original command before SQL', async () => {
  let calls = 0;
  const read = reader([], { query: async () => { calls++; } });
  for (const patch of [{ tenantId: '' }, { locationId: ' ' }, { authenticatedActorId: null },
    { authenticatedActorId: 9007199254740992 }, { clientId: '20 OR 1=1' }, { clientId: '9223372036854775808' }]) {
    await assert.rejects(read({ ...request(), ...patch }), TypeError);
  }
  for (const patch of [{ amount: 0 }, { amount: 1.5 }, { amount: Infinity }, { reason: ' ' },
    { reason: 'x'.repeat(8193) }, { requestKey: '' }, { requestKey: 'key with spaces' }]) {
    await assert.rejects(read({ ...request(), command: { ...request().command, ...patch } }), TypeError);
  }
  assert.equal(calls, 0);
});

test('only exact completed evidence can clear pending; missing/cancelled/pending cannot', async () => {
  assert.deepEqual(await reader([])(request()), { state: 'unknown', canClearPending: false });
  for (const status of ['cancelled', 'pending', 'declined', 'expired']) {
    assert.deepEqual(await reader([{ ...row(), status }])(request()), { state: status === 'cancelled' ? 'cancelled' : 'unknown', canClearPending: false });
  }
  for (const patch of [{ reason: 'Other reason' }, { mode: 'accrue' }, { bonus_earned: 26 }, { bonus_spent: 1 }]) {
    assert.deepEqual(await reader([{ ...row(), ...patch }])(request()), { state: 'conflict', canClearPending: false });
  }
  const confirmed = await reader([row()])(request());
  assert.deepEqual(confirmed, { state: 'confirmed', canClearPending: true, transactionId: '1', balanceAfter: 125 });
  assert.ok(Object.isFrozen(confirmed));
});

test('malformed, duplicate, unsafe and out-of-scope SQL results fail closed', async () => {
  for (const result of [null, {}, { rows: {} }, { rows: [row(), row()] },
    ...[{ tenant_id: 'tenant-b' }, { location_id: null }, { staff_id: '11' }, { client_id: '21' },
      { request_key: 'other-key' }, { balance_after: '9007199254740992' }, { bonus_earned: null }].map(patch => ({ rows: [{ ...row(), ...patch }] }))]) {
    const read = reader([], { query: async () => result });
    await assert.rejects(read(request()), { code: 'ADJUSTMENT_STATUS_INVALID_RESULT' });
  }
});

test('database errors propagate without converting outage into unknown or confirmation', async () => {
  const outage = Error('SQL unavailable');
  await assert.rejects(reader([], { query: async () => { throw outage; } })(request()), error => error === outage);
});

async function database(t) {
  const db = new PGlite(); t.after(() => db.close());
  const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  for (const table of ['users', 'wallets', 'transactions']) {
    const schema = source.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n      \\)`));
    assert.ok(schema); await db.exec(schema[0]);
  }
  for (const column of ['balance_after', 'bonus_earned', 'bonus_spent']) {
    await db.exec(`ALTER TABLE transactions ALTER COLUMN ${column} TYPE BIGINT`);
  }
  // Actual additive migration, only in this disposable database.
  await db.exec(await readFile(new URL('../migrations/009_spaceverse_tenant_attribution.sql', import.meta.url), 'utf8'));
  await db.exec("INSERT INTO users(id, first_name, role) VALUES (10,'Owner','admin'),(11,'Other','admin'),(20,'Client','client'),(21,'Other client','client'); INSERT INTO wallets(user_id,balance) VALUES(20,999),(21,100)");
  const insert = async (patch = {}) => {
    const r = { ...row(), ...patch };
    await db.query(`INSERT INTO transactions(tenant_id,location_id,client_id,staff_id,request_key,mode,status,bonus_earned,bonus_spent,balance_after,reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [r.tenant_id,r.location_id,r.client_id,r.staff_id,r.request_key,r.mode,r.status,r.bonus_earned,r.bonus_spent,r.balance_after,r.reason]);
  };
  const snapshot = async () => ({ wallets: (await db.query('SELECT * FROM wallets ORDER BY user_id')).rows,
    journal: (await db.query('SELECT * FROM transactions ORDER BY id')).rows });
  const calls = [];
  const read = createAdminAdjustmentStatusReader({ scopedReadsEnabled: true, query: async (sql, params) => {
    calls.push({ sql, params }); return db.query(sql, params);
  } });
  return { db, insert, snapshot, read, calls };
}
for (const amount of [25, -25]) test(`real SQL confirms ${amount} and repeat reads leave wallet/journal untouched`, async t => {
  const h = await database(t);
  await h.insert({ bonus_earned: amount > 0 ? amount : 0, bonus_spent: amount < 0 ? -amount : 0, balance_after: 100 + amount });
  const before = await h.snapshot(), input = { ...request(), command: { ...request().command, amount } };
  for (let n = 0; n < 2; n++) assert.deepEqual(await h.read(input), {
    state: 'confirmed', canClearPending: true, transactionId: '1', balanceAfter: 100 + amount });
  assert.deepEqual(await h.snapshot(), before); // Current wallet 999 is deliberately different.
  assert.equal(h.calls.length, 2);
  for (const { sql, params } of h.calls) {
    assert.deepEqual(params, ['tenant-a','location-a','10','20','status-fixture-key']);
    assert.match(sql, /tenant_id = \$1 AND location_id = \$2 AND staff_id = \$3::bigint/);
    assert.match(sql, /client_id = \$4::bigint AND request_key = \$5/);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|FOR UPDATE)\b/);
  }
});

test('real SQL hides foreign tenant/location/actor/client and legacy unattributed records', async t => {
  const h = await database(t);
  await h.insert();
  const before = await h.snapshot();
  for (const patch of [{ tenantId: 'tenant-b' }, { locationId: 'location-b' },
    { authenticatedActorId: '11' }, { clientId: '21' }]) {
    const authorizationContext = createAuthorizationContext({ platformRole: 'platform_admin' });
    assert.deepEqual(await h.read({ ...request(), authorizationContext, ...patch }), { state: 'unknown', canClearPending: false });
  }
  await h.db.exec('UPDATE transactions SET tenant_id=NULL,location_id=NULL');
  const legacy = await h.snapshot();
  assert.deepEqual(await h.read(request()), { state: 'unknown', canClearPending: false });
  assert.deepEqual(await h.snapshot(), legacy);
  assert.equal(before.journal.length, 1);
});

test('real SQL distinguishes semantic conflict and cancellation without changing data', async t => {
  const h = await database(t); await h.insert(); const before = await h.snapshot();
  for (const command of [{ ...request().command, amount: 26 }, { ...request().command, reason: 'Other reason' }]) {
    assert.deepEqual(await h.read({ ...request(), command }), { state: 'conflict', canClearPending: false });
  }
  assert.deepEqual(await h.snapshot(), before);
  await h.db.exec("UPDATE transactions SET status='cancelled'");
  const cancelled = await h.snapshot();
  assert.deepEqual(await h.read(request()), { state: 'cancelled', canClearPending: false });
  assert.deepEqual(await h.snapshot(), cancelled);
});

test('missing attribution migration raises SQL error without a legacy fallback', async t => {
  const h = await database(t); await h.insert();
  await h.db.exec('ALTER TABLE transactions DROP COLUMN tenant_id, DROP COLUMN location_id');
  const before = await h.snapshot();
  await assert.rejects(h.read(request()), error => error.code === '42703');
  assert.equal(h.calls.length, 1);
  assert.deepEqual(await h.snapshot(), before);
});
