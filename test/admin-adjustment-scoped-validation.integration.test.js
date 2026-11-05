import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createAuthorizationContext } from '../authorization-context.js';
import { createAdminAdjustmentPersistence } from '../admin-adjustment-persistence.js';

test('scoped adjustment validation preserves real SQL journal and valid credit/debit persistence', async t => {
  const db = new PGlite(); t.after(() => db.close());
  const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  for (const table of ['users', 'wallets', 'transactions']) {
    const schema = source.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n      \\)`));
    assert.ok(schema); await db.exec(schema[0]);
  }
  await db.exec(await readFile(new URL('../migrations/009_spaceverse_tenant_attribution.sql', import.meta.url), 'utf8'));
  await db.exec("INSERT INTO users(id,first_name,role) VALUES(10,'Owner','admin'),(20,'Client','client'); INSERT INTO wallets(user_id,balance) VALUES(20,999)");
  const snapshot = async () => ({ users: (await db.query('SELECT * FROM users ORDER BY id')).rows,
    wallets: (await db.query('SELECT * FROM wallets ORDER BY user_id')).rows,
    journal: (await db.query('SELECT * FROM transactions ORDER BY id')).rows });
  let calls = 0;
  const persist = createAdminAdjustmentPersistence({ scopedWritesEnabled: true,
    query: async (sql, params) => { calls++; return db.query(sql, params); } });
  const scope = { authorizationContext: createAuthorizationContext({ membershipRole: 'owner', tenantId: 'tenant-a' }),
    tenantId: 'tenant-a', locationId: 'location-a' };
  const transaction = { request_key: 'credit', client_id: '20', staff_id: '10', mode: 'adjustment',
    status: 'completed', bonus_earned: 25, bonus_spent: 0, balance_after: 125, reason: 'Isolated correction' };
  const before = await snapshot();
  for (const patch of [{ mode: 'accrue' }, { status: 'pending' }, { status: 'cancelled' }]) {
    await assert.rejects(persist({ ...scope, transaction: { ...transaction, ...patch } }), TypeError);
  }
  assert.equal(calls, 0); assert.deepEqual(await snapshot(), before);
  await assert.rejects(persist({ ...scope, tenantId: 'other-tenant', transaction }), { code: 'TRANSACTION_SCOPE_FORBIDDEN' });
  assert.equal(calls, 0);
  const credit = await persist({ ...scope, transaction });
  const debit = await persist({ ...scope, transaction: { ...transaction, request_key: 'debit',
    bonus_earned: 0, bonus_spent: 10, balance_after: 115 } });
  for (const saved of [credit, debit]) {
    assert.equal(saved.mode, 'adjustment'); assert.equal(saved.status, 'completed');
    assert.equal(saved.tenant_id, 'tenant-a'); assert.equal(saved.location_id, 'location-a');
    assert.equal(String(saved.staff_id), '10'); assert.equal(saved.reason, transaction.reason);
  }
  const saved = await snapshot(); assert.equal(saved.journal.length, 2);
  assert.deepEqual(saved.users, before.users); assert.deepEqual(saved.wallets, before.wallets);
  await assert.rejects(persist({ ...scope, transaction }), error => error.code === '23505');
  assert.deepEqual(await snapshot(), saved);
  const outage = Error('fixture SQL outage'); let attempts = 0;
  const failed = createAdminAdjustmentPersistence({ scopedWritesEnabled: true,
    query: async () => { attempts++; throw outage; } });
  await assert.rejects(failed({ ...scope, transaction }), error => error === outage);
  assert.equal(attempts, 1); assert.deepEqual(await snapshot(), saved);
});
