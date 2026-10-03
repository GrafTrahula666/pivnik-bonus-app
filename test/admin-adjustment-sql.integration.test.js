import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { normalizeRequestKey } from '../platform-core.js';
import { createAdminAdjustmentPersistence } from '../admin-adjustment-persistence.js';

// Exercise the checked-out route, middleware, replay helpers and persistence
// adapter. Importing server.js would also start unrelated runtime services.
const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
function between(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing source anchors: ${start}`);
  return source.slice(from, to);
}
const auth = between('async function authRequired(', 'async function resolveActingStaff(');
const replay = between('async function lockRequestKey(', 'function signSession(');
const route = between("app.post('/api/admin/users/:id/adjust'", "app.post('/api/admin/transactions/:id/cancel'");

async function harness(t) {
  const db = new PGlite();
  t.after(() => db.close());
  // Use the actual legacy schema and relevant startup upgrades, not a mock
  // journal or a permissive schema that could hide FK/uniqueness failures.
  for (const table of ['users', 'wallets', 'transactions']) {
    const match = source.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n      \\)`));
    assert.ok(match, `Missing ${table} schema`);
    await db.exec(match[0]);
  }
  const upgrades = source.match(/ALTER TABLE (?:users ADD COLUMN IF NOT EXISTS (?:merged_into_user_id|session_version|deleted_at|unlimited_bonus)[^'\n]*|wallets ALTER COLUMN balance TYPE BIGINT|transactions ALTER COLUMN (?:balance_after|bonus_spent|bonus_earned) TYPE BIGINT)/g);
  assert.equal(upgrades.length, 8);
  for (const sql of upgrades) await db.exec(sql);
  await db.exec(`
    INSERT INTO users (id, first_name, role) VALUES
      (10, 'Admin fixture', 'admin'), (11, 'Other admin', 'admin'),
      (12, 'Staff fixture', 'staff'), (20, 'Client fixture', 'client'),
      (21, 'Other client', 'client');
    INSERT INTO wallets (user_id, balance) VALUES (20, 100), (21, 100);
  `);
  let connections = 0, releases = 0;
  const query = async (sql, params = []) => {
    const result = await db.query(sql, params);
    return { ...result, rowCount: /^\s*SELECT/i.test(sql) ? result.rows.length : result.affectedRows };
  };
  const pool = { query, async connect() {
    connections++;
    return { query, release() { releases++; } };
  } };
  const app = express();
  app.use(express.json());
  const wire = new Function('app', 'pool', 'verifySession', 'getProfile', 'effectiveRoleForAuthenticatedIdentity',
    'ownerTelegramId', 'ownerVkId', 'normalizeRequestKey', 'hasUnlimitedBonus', 'createAdminAdjustmentPersistence', auth + replay + route);
  wire(app, pool,
    token => /^1[012]$/.test(token) ? { uid: token, sv: 1, platform: 'telegram' } : null,
    async id => (await query('SELECT id, role FROM users WHERE id = $1', [id])).rows[0],
    role => role, null, null, normalizeRequestKey, row => row.unlimited_bonus === true,
    createAdminAdjustmentPersistence);
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  return {
    db,
    async snapshot() {
      return {
        wallets: (await query('SELECT user_id, balance FROM wallets ORDER BY user_id')).rows,
        journal: (await query('SELECT request_key, client_id, staff_id, mode, status, bonus_spent, bonus_earned, balance_after, reason, completed_at FROM transactions ORDER BY id')).rows
      };
    },
    get connections() { return connections; },
    get releases() { return releases; },
    async adjust(amount, { token = '10', id = 20, key = 'sql-adjustment-fixture', reason = 'Fixture correction' } = {}) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/users/${id}/adjust`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ amount, reason, requestKey: key })
      });
      return { status: response.status, body: await response.json() };
    }
  };
}

test('adjustment SQL: credit/debit persist wallet, actor, reason and completed journal together', async t => {
  const h = await harness(t);
  assert.deepEqual(await h.adjust(25), { status: 200, body: { ok: true, balance: 125 } });
  assert.deepEqual(await h.adjust(-10, { key: 'sql-debit-fixture' }), { status: 200, body: { ok: true, balance: 115 } });
  const { wallets, journal } = await h.snapshot();
  assert.equal(Number(wallets[0].balance), 115);
  assert.equal(journal.length, 2);
  assert.deepEqual(journal.map(row => [Number(row.bonus_spent), Number(row.bonus_earned), Number(row.balance_after)]), [[0, 25, 125], [10, 0, 115]]);
  for (const row of journal) {
    assert.equal(Number(row.client_id), 20);
    assert.equal(Number(row.staff_id), 10);
    assert.equal(row.reason, 'Fixture correction');
    assert.equal(row.mode, 'adjustment');
    assert.equal(row.status, 'completed');
    assert.ok(row.completed_at);
  }
  assert.equal(h.releases, 2);
});

test('adjustment SQL: replay does not credit twice; changed actor/client/amount/reason conflicts', async t => {
  const h = await harness(t);
  await h.adjust(25);
  const before = await h.snapshot();
  assert.deepEqual(await h.adjust(25), { status: 200, body: { ok: true, balance: 125, replayed: true } });
  for (const [amount, options] of [[26, {}], [25, { reason: 'Changed' }], [25, { token: '11' }], [25, { id: 21 }]]) {
    assert.equal((await h.adjust(amount, options)).status, 409);
    assert.deepEqual(await h.snapshot(), before);
  }
  assert.equal(h.releases, 6);
});

test('adjustment SQL: database rejection of journal INSERT rolls wallet back and retry succeeds', async t => {
  const h = await harness(t);
  const before = await h.snapshot();
  // Real SQL error after UPDATE, rather than throwing from a query stub.
  await h.db.exec("ALTER TABLE transactions ADD CONSTRAINT fixture_insert_failure CHECK (reason <> 'Fixture correction')");
  assert.equal((await h.adjust(25)).status, 500);
  assert.deepEqual(await h.snapshot(), before);
  assert.equal(h.releases, 1);
  await h.db.exec('ALTER TABLE transactions DROP CONSTRAINT fixture_insert_failure');
  assert.deepEqual(await h.adjust(25), { status: 200, body: { ok: true, balance: 125 } });
  assert.equal((await h.snapshot()).journal.length, 1);
  assert.equal(h.releases, 2);
});

test('adjustment SQL: unauthorized and invalid requests do not connect to the wallet transaction', async t => {
  const h = await harness(t), before = await h.snapshot();
  assert.equal((await h.adjust(25, { token: '' })).status, 401);
  assert.equal((await h.adjust(25, { token: '12' })).status, 403);
  for (const [amount, options] of [[0, {}], [25, { reason: '' }], [25, { key: '' }]]) {
    assert.equal((await h.adjust(amount, options)).status, 400);
  }
  assert.equal(h.connections, 0);
  assert.deepEqual(await h.snapshot(), before);
});

test('adjustment SQL: missing client and overdraft roll back; next valid request remains usable', async t => {
  const h = await harness(t), before = await h.snapshot();
  assert.equal((await h.adjust(25, { id: 999 })).status, 404);
  assert.equal((await h.adjust(-101)).status, 400);
  assert.deepEqual(await h.snapshot(), before);
  assert.deepEqual(await h.adjust(-100), { status: 200, body: { ok: true, balance: 0 } });
  assert.equal(h.releases, 3);
});
