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


const clientSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const clientStart = clientSource.indexOf('const pendingAdminAdjustments =');
const clientEnd = clientSource.indexOf("\n$('#openProfileSettings')?.addEventListener", clientStart);
assert.ok(clientStart >= 0 && clientEnd > clientStart);

test('adjustment UI + HTTP + SQL: saved response loss recovers one journal entry and one credit', async t => {
  const h = await harness(t);
  const messages = [], commands = [];
  let keys = 0, loseReply = true, confirmations = 0;
  const state = { profile: { id: '10', role: 'admin' } };
  const prompts = ['25', 'Fixture correction'];
  const run = new Function('state', 'prompt', 'confirm', 'roleCanWrite', 'api', 'requestId', 'toast',
    'refreshAdminUsersDirectory', 'fmt', '$$', clientSource.slice(clientStart, clientEnd) + '\nreturn adjustAdminBonus;')(
    state, () => prompts.shift(), () => { confirmations++; return true; }, role => role === 'admin',
    async (url, options) => {
      assert.equal(options.retries, 0);
      const command = JSON.parse(options.body); commands.push(command);
      const reply = await h.adjust(command.amount, { key: command.requestKey, reason: command.reason });
      assert.equal(reply.status, 200);
      if (loseReply) { loseReply = false; throw Error('Simulated lost transport response after server COMMIT'); }
      return reply.body;
    }, () => `ui-sql-request-${++keys}`, text => messages.push(text), async () => {}, String, () => []);
  const button = { dataset: { adjustUser: '20' }, disabled: false, textContent: 'Баланс' };
  await run(button);
  assert.equal(button.textContent, 'Повторить');
  let snapshot = await h.snapshot();
  assert.equal(Number(snapshot.wallets[0].balance), 125); assert.equal(snapshot.journal.length, 1);
  await run(button);
  snapshot = await h.snapshot();
  assert.equal(Number(snapshot.wallets[0].balance), 125); assert.equal(snapshot.journal.length, 1);
  assert.deepEqual(commands[0], commands[1]); assert.equal(keys, 1); assert.equal(confirmations, 1);
  assert.equal(snapshot.journal[0].reason, 'Fixture correction');
  assert.equal(String(snapshot.journal[0].staff_id), '10');
  assert.equal(messages.at(-1), 'Баланс изменён: 125 Б');
  assert.equal(button.textContent, 'Баланс');
});
