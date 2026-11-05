import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createAuthorizationContext } from '../authorization-context.js';
import { createAdminAdjustmentPersistence } from '../admin-adjustment-persistence.js';
import { createAdminAdjustmentStatusReader } from '../admin-adjustment-status.js';

const owner = createAuthorizationContext({ membershipRole: 'owner', tenantId: 'tenant-a' });
const input = (amount = 25) => ({ authorizationContext: owner, tenantId: 'tenant-a',
  locationId: 'location-a', authenticatedActorId: '10', clientId: '20',
  command: { amount, reason: 'Isolated correction', requestKey: 'writer-status-key' } });
const writeInput = (amount = 25) => ({ authorizationContext: owner, tenantId: 'tenant-a',
  locationId: 'location-a', transaction: { request_key: 'writer-status-key', client_id: '20',
    staff_id: '10', mode: 'adjustment', status: 'completed', bonus_earned: Math.max(amount, 0),
    bonus_spent: Math.max(-amount, 0), balance_after: 100 + amount, reason: 'Isolated correction' } });

async function fixture(t, migrated = true) {
  const db = new PGlite(); t.after(() => db.close());
  const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  for (const table of ['users', 'wallets', 'transactions']) {
    const schema = source.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n      \\)`));
    assert.ok(schema); await db.exec(schema[0]);
  }
  if (migrated) await db.exec(await readFile(new URL('../migrations/009_spaceverse_tenant_attribution.sql', import.meta.url), 'utf8'));
  await db.exec("INSERT INTO users(id,first_name,role) VALUES(10,'Owner','admin'),(11,'Other','staff'),(20,'Client','client'); INSERT INTO wallets(user_id,balance) VALUES(20,999)");
  const calls = [];
  const query = async (sql, values) => { calls.push(sql); return db.query(sql, values); };
  const write = createAdminAdjustmentPersistence({ query, scopedWritesEnabled: true });
  const read = createAdminAdjustmentStatusReader({ query, scopedReadsEnabled: true });
  const snapshot = async () => ({ users: (await db.query('SELECT * FROM users ORDER BY id')).rows,
    wallets: (await db.query('SELECT * FROM wallets ORDER BY user_id')).rows,
    journal: (await db.query('SELECT * FROM transactions ORDER BY id')).rows });
  return { db, query, write, read, calls, snapshot };
}

// These exercise journal persistence, not a wallet executor or production route.
for (const amount of [25, -25]) test(`scoped writer produces exact readable ${amount} evidence without wallet writes`, async t => {
  const h = await fixture(t), before = await h.snapshot();
  const saved = await h.write(writeInput(amount));
  assert.equal(saved.tenant_id, 'tenant-a'); assert.equal(saved.location_id, 'location-a');
  assert.equal(String(saved.staff_id), '10'); assert.equal(String(saved.client_id), '20');
  const afterWrite = await h.snapshot();
  assert.deepEqual(afterWrite.wallets, before.wallets); assert.deepEqual(afterWrite.users, before.users);
  assert.equal(afterWrite.journal.length, 1);
  for (let n = 0; n < 2; n++) assert.deepEqual(await h.read(input(amount)), {
    state: 'confirmed', canClearPending: true, transactionId: String(saved.id), balanceAfter: 100 + amount });
  assert.deepEqual(await h.snapshot(), afterWrite);
  assert.equal(afterWrite.wallets[0].balance, 999); // Saved evidence is not current balance.
});

test('duplicate scoped INSERT fails unique constraint; status read remains safe and exact', async t => {
  const h = await fixture(t); await h.write(writeInput()); const before = await h.snapshot();
  await assert.rejects(h.write(writeInput()), error => error.code === '23505');
  assert.deepEqual(await h.snapshot(), before);
  assert.equal((await h.read(input())).state, 'confirmed');
  for (const command of [{ ...input().command, amount: 26 }, { ...input().command, reason: 'Different' }]) {
    assert.deepEqual(await h.read({ ...input(), command }), { state: 'conflict', canClearPending: false });
  }
  for (const patch of [{ authenticatedActorId: '11' }, { locationId: 'other-location' }]) {
    assert.deepEqual(await h.read({ ...input(), ...patch }), { state: 'unknown', canClearPending: false });
  }
  assert.deepEqual(await h.snapshot(), before);
});

test('foreign scope, invalid transaction and disabled writer are rejected before INSERT', async t => {
  const h = await fixture(t), before = await h.snapshot();
  await assert.rejects(h.write({ ...writeInput(), tenantId: 'tenant-b' }), { code: 'TRANSACTION_SCOPE_FORBIDDEN' });
  await assert.rejects(h.write({ ...writeInput(), locationId: ' ' }), TypeError);
  await assert.rejects(h.write({ ...writeInput(), transaction: { ...writeInput().transaction, tenant_id: 'spoof' } }), TypeError);
  const disabled = createAdminAdjustmentPersistence({ query: h.query });
  await assert.rejects(disabled(writeInput()), { code: 'TRANSACTION_SCOPE_MIGRATION_GATED' });
  assert.equal(h.calls.length, 0); assert.deepEqual(await h.snapshot(), before);
});

test('missing migration and SQL outage never fall back to legacy insertion', async t => {
  const h = await fixture(t, false), before = await h.snapshot();
  await assert.rejects(h.write(writeInput()), error => error.code === '42703');
  assert.equal(h.calls.length, 1); assert.match(h.calls[0], /tenant_id, location_id/);
  assert.deepEqual(await h.snapshot(), before);
  const outage = Error('fixture SQL unavailable'); let calls = 0;
  const write = createAdminAdjustmentPersistence({ scopedWritesEnabled: true, query: async () => { calls++; throw outage; } });
  await assert.rejects(write(writeInput()), error => error === outage); assert.equal(calls, 1);
});

test('generic scoped writer does not supply admin authorization or bind actor identity', async t => {
  const h = await fixture(t);
  const staff = createAuthorizationContext({ membershipRole: 'staff', tenantId: 'tenant-a', locationId: 'location-a' });
  // Existing shared persistence accepts a location writer and caller-supplied staff_id.
  // A future admin executor MUST authorize owner rights and bind the session actor first.
  await h.write({ ...writeInput(), authorizationContext: staff });
  const before = await h.snapshot();
  await assert.rejects(h.read({ ...input(), authorizationContext: staff }), { code: 'ADJUSTMENT_STATUS_FORBIDDEN' });
  assert.deepEqual(await h.snapshot(), before);
  assert.equal(String(before.journal[0].staff_id), '10');
});
