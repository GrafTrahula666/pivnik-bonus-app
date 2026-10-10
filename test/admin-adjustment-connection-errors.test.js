import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { normalizeRequestKey } from '../platform-core.js';
import { createAdminAdjustmentPersistence } from '../admin-adjustment-persistence.js';

// Run the real checked-out handler without importing server startup services.
const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
function between(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing handler anchors: ${start}`);
  return source.slice(from, to);
}
const route = between("app.post('/api/admin/users/:id/adjust'", "app.post('/api/admin/transactions/:id/cancel'");
const helpers = between('async function lockRequestKey(', 'function signSession(');

function handler(pool) {
  let execute;
  const app = { post(path, ...handlers) { execute = handlers.at(-1); } };
  new Function('app', 'pool', 'authRequired', 'requireRole', 'normalizeRequestKey',
    'hasUnlimitedBonus', 'createAdminAdjustmentPersistence', helpers + route)(
    app, pool, () => {}, () => () => {}, normalizeRequestKey,
    row => row.unlimited_bonus, createAdminAdjustmentPersistence);
  return execute;
}

async function invoke(execute, body = {}) {
  const errors = [], replies = [];
  const res = { status(code) { this.code = code; return this; }, json(value) { replies.push({ status: this.code || 200, body: value }); } };
  await execute({ params: { id: '20' }, user: { id: '10' }, body: {
    amount: 25, reason: 'Fixture correction', requestKey: 'connection-error-fixture', ...body
  } }, res, error => errors.push(error));
  return { errors, replies };
}

test('adjustment: pool connection rejection reaches Express next once without false success', async () => {
  const failure = new Error('fixture pool unavailable');
  let attempts = 0;
  const result = await invoke(handler({ async connect() { attempts++; throw failure; } }));
  assert.equal(attempts, 1);
  assert.deepEqual(result.errors, [failure]);
  assert.deepEqual(result.replies, []);
});

test('adjustment: BEGIN failure preserves original error, attempts rollback and releases connection', async () => {
  const failure = new Error('fixture connection lost'), calls = [];
  let released = 0;
  const result = await invoke(handler({ async connect() { return {
    async query(sql) { calls.push(sql); throw failure; },
    release() { released++; }
  }; } }));
  assert.deepEqual(result.errors, [failure]);
  assert.deepEqual(result.replies, []);
  assert.deepEqual(calls, ['BEGIN', 'ROLLBACK']);
  assert.equal(released, 1);
});

test('adjustment: invalid input returns 400 before acquiring a connection', async () => {
  let attempts = 0;
  const execute = handler({ async connect() { attempts++; throw new Error('must not connect'); } });
  for (const body of [{ amount: 0 }, { reason: '' }, { requestKey: '' }]) {
    const result = await invoke(execute, body);
    assert.equal(result.replies[0].status, 400);
    assert.deepEqual(result.errors, []);
  }
  assert.equal(attempts, 0);
});

test('adjustment HTTP: connection failures return server-confirmed 500 through Express and gateway', async t => {
  const app = express();
  app.use(express.json());
  let attempts = 0;
  const execute = handler({ async connect() {
    attempts++;
    throw Object.assign(new Error('fixture database secret'), { code: '53300' });
  } });
  // Authorization is outside this connection-lifecycle test boundary.
  app.post('/api/admin/users/:id/adjust', (req, res, next) => {
    req.user = { id: '10' }; next();
  }, execute);
  new Function('app', 'console', between('app.use((error, _req, res, _next)', 'await initDatabase();'))(app, { error() {} });
  const child = app.listen(0, '127.0.0.1');
  await once(child, 'listening');
  t.after(() => new Promise(resolve => child.close(resolve)));
  const gateway = await readFile(new URL('../universal-server.js', import.meta.url), 'utf8');
  const from = gateway.indexOf('async function readRequestBody('), to = gateway.indexOf('export async function renderAppIndex(');
  assert.ok(from >= 0 && to > from);
  const proxy = new Function('http', 'internalPort', 'childReady', 'MAX_BODY_BYTES', 'canonicalizeSessionToken',
    gateway.slice(from, to) + '\nreturn proxyRequest;')(http, child.address().port, true, 1024 * 1024,
    async token => ({ token, payload: {} }));
  const publicServer = http.createServer((req, res) => proxy(req, res));
  publicServer.listen(0, '127.0.0.1');
  await once(publicServer, 'listening');
  t.after(() => new Promise(resolve => publicServer.close(resolve)));
  for (const server of [child, publicServer]) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/users/20/adjust`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 25, reason: 'Fixture correction', requestKey: 'connection-error-http' }),
      signal: AbortSignal.timeout(3000)
    });
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.deepEqual(body, { error: 'Сервер временно не смог загрузить данные. Повторите вход.' });
    assert.equal(body.ok, undefined);
  }
  assert.equal(attempts, 2);
});
