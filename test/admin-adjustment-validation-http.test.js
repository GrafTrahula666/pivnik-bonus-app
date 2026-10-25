import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { normalizeRequestKey } from '../platform-core.js';
import { createAdminAdjustmentPersistence } from '../admin-adjustment-persistence.js';

// Execute the actual route and authentication/role middleware with fixture DB
// and session providers. No server startup, production credentials or DB access.
const source = await fs.readFile(new URL('../server.js', import.meta.url), 'utf8');
function between(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing route fixture anchors: ${start}`);
  return source.slice(from, to);
}
const route = between("app.post('/api/admin/users/:id/adjust'", "app.post('/api/admin/transactions/:id/cancel'");
const auth = between('async function authRequired(', 'async function resolveActingStaff(');
const replay = between('async function lockRequestKey(', 'function signSession(');
const gatewaySource = await fs.readFile(new URL('../universal-server.js', import.meta.url), 'utf8');
const proxySource = gatewaySource.slice(gatewaySource.indexOf('async function readRequestBody('), gatewaySource.indexOf('export async function renderAppIndex('));

async function harness(t, { balance = 100, failure = null, unlimited = false, gateway = false } = {}) {
  const journal = new Map(), writes = [], queries = [];
  let wallet = balance, before = balance, connections = 0;
  const client = {
    async query(sql, params = []) {
      queries.push(sql);
      if (failure && sql.startsWith(failure)) throw new Error('fixture-db-failure');
      if (sql === 'BEGIN') before = wallet;
      if (sql === 'ROLLBACK') wallet = before;
      if (sql.includes('FROM users')) return { rowCount: 1, rows: [{ id: '20', role: 'client', unlimited_bonus: unlimited }] };
      if (sql.startsWith('SELECT balance')) return { rowCount: 1, rows: [{ balance: wallet }] };
      if (sql.startsWith('SELECT * FROM transactions')) {
        const row = journal.get(params[0]);
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }
      if (sql.startsWith('UPDATE wallets')) { writes.push(params); wallet = params[0]; }
      if (sql.includes('INSERT INTO transactions')) {
        const [key, clientId, staffId, spent, earned, after, reason] = params;
        journal.set(key, { client_id: clientId, staff_id: staffId, mode: 'adjustment', bonus_spent: spent, bonus_earned: earned, balance_after: after, reason });
      }
      return { rowCount: 1, rows: [] };
    },
    release() {}
  };
  const pool = {
    async query() { return { rowCount: 1, rows: [{ session_version: 1 }] }; },
    async connect() { connections++; return client; }
  };
  const app = express();
  app.use(express.json());
  const wire = new Function('app', 'pool', 'verifySession', 'getProfile', 'effectiveRoleForAuthenticatedIdentity',
    'ownerTelegramId', 'ownerVkId', 'normalizeRequestKey', 'hasUnlimitedBonus', 'createAdminAdjustmentPersistence',
    auth + replay + route);
  wire(app, pool,
    token => ['admin', 'viewer', 'staff', 'client'].includes(token) ? { uid: '10', sv: 1, platform: 'telegram', pid: token } : null,
    async () => ({ id: '10', role: 'client' }),
    (role, platform, pid) => pid, null, null, normalizeRequestKey,
    row => row.unlimited_bonus === true, createAdminAdjustmentPersistence);
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  let port = server.address().port;
  if (gateway) {
    const proxy = new Function('http', 'internalPort', 'childReady', 'MAX_BODY_BYTES', 'canonicalizeSessionToken', proxySource + '\nreturn proxyRequest;')(
      http, port, true, 1024 * 1024, async token => ({ token, payload: {} }));
    const gatewayServer = http.createServer((req, res) => proxy(req, res).catch(error => {
      res.writeHead(500); res.end(error.message);
    }));
    gatewayServer.listen(0, '127.0.0.1');
    await once(gatewayServer, 'listening');
    t.after(() => new Promise((resolve, reject) => gatewayServer.close(error => error ? reject(error) : resolve())));
    port = gatewayServer.address().port;
  }
  const base = `http://127.0.0.1:${port}`;
  return {
    writes, queries, journal,
    get balance() { return wallet; },
    get connections() { return connections; },
    async adjust(amount, { token = 'admin', key = 'adjust-http-fixture-1', reason = 'fixture reason' } = {}) {
      const response = await fetch(`${base}/api/admin/users/20/adjust`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ amount, reason, requestKey: key })
      });
      return { status: response.status, body: await response.json() };
    }
  };
}

test('adjustment HTTP rejects fractional, coercible and unsafe amounts before connecting to DB', async t => {
  const h = await harness(t);
  for (const amount of [1.9, -1.9, '1.9', true, false, [25], { value: 25 }, 'Infinity', '1e309', '0x10', '1e2', 0, null, '', Number.MAX_SAFE_INTEGER + 1, '-9007199254740992']) {
    assert.equal((await h.adjust(amount)).status, 400, JSON.stringify(amount));
  }
  assert.equal(h.connections, 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.journal.size, 0);
});

test('adjustment HTTP preserves integer credits/debits and journaled actor/reason', async t => {
  const h = await harness(t);
  assert.deepEqual(await h.adjust(25), { status: 200, body: { ok: true, balance: 125 } });
  assert.deepEqual(await h.adjust(' -10 ', { key: 'adjust-http-fixture-2' }), { status: 200, body: { ok: true, balance: 115 } });
  assert.equal(h.journal.size, 2);
  assert.equal(h.journal.get('adjust-http-fixture-2').bonus_spent, 10);
  assert.equal(h.journal.get('adjust-http-fixture-1').staff_id, '10');
  assert.equal(h.journal.get('adjust-http-fixture-1').reason, 'fixture reason');
});

test('adjustment HTTP denies missing sessions and non-admin roles before wallet access', async t => {
  const h = await harness(t);
  assert.equal((await h.adjust(25, { token: '' })).status, 401);
  for (const token of ['viewer', 'staff', 'client']) assert.equal((await h.adjust(25, { token })).status, 403);
  assert.equal(h.connections, 0);
});

test('adjustment HTTP preserves replay and conflicts for a changed request payload', async t => {
  const h = await harness(t);
  await h.adjust(25);
  assert.deepEqual(await h.adjust(25), { status: 200, body: { ok: true, balance: 125, replayed: true } });
  assert.equal((await h.adjust(26)).status, 409);
  assert.equal(h.balance, 125);
  assert.equal(h.writes.length, 1);
  assert.equal(h.journal.size, 1);
});

test('adjustment HTTP rejects unsafe old/resulting balances with rollback and no writes', async t => {
  for (const balance of ['9007199254740993', Number.MAX_SAFE_INTEGER]) {
    const h = await harness(t, { balance });
    assert.equal((await h.adjust(1)).status, 409);
    assert.equal(h.balance, balance);
    assert.equal(h.writes.length, 0);
    assert.equal(h.journal.size, 0);
    assert.ok(h.queries.includes('ROLLBACK'));
  }
});

test('adjustment HTTP rejects insufficient balance and unlimited wallets', async t => {
  const h = await harness(t);
  assert.equal((await h.adjust(-101)).status, 400);
  assert.equal(h.writes.length, 0);
  const unlimited = await harness(t, { unlimited: true });
  assert.equal((await unlimited.adjust(25)).status, 400);
  assert.equal(unlimited.writes.length, 0);
});

test('adjustment HTTP rolls back a failed journal insert and does not report success', async t => {
  const h = await harness(t, { failure: 'INSERT INTO transactions' });
  assert.equal((await h.adjust(25)).status, 500);
  assert.equal(h.balance, 100);
  assert.equal(h.journal.size, 0);
  assert.ok(h.queries.includes('ROLLBACK'));
});

test('gateway proxy preserves adjustment validation, authorization and replay responses', async t => {
  // Gateway has no independent adjustment handler; it forwards this API to
  // server.js. The real proxy below is exercised with fixture session providers.
  assert.doesNotMatch(gatewaySource, /url\.pathname[^\n]*\/api\/admin[^\n]*adjust/);
  assert.match(gatewaySource, /return await proxyRequest\(req, res\);/);
  const h = await harness(t, { gateway: true });
  assert.equal((await h.adjust(true)).status, 400);
  assert.equal((await h.adjust(25, { token: '' })).status, 401);
  assert.equal((await h.adjust(25, { token: 'viewer' })).status, 403);
  assert.deepEqual(await h.adjust(25), { status: 200, body: { ok: true, balance: 125 } });
  assert.deepEqual(await h.adjust(25), { status: 200, body: { ok: true, balance: 125, replayed: true } });
  assert.equal(h.writes.length, 1);
});
