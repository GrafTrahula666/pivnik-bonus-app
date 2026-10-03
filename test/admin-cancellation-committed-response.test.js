import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { normalizeRequestKey } from '../platform-core.js';

const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
const from = source.indexOf("app.post('/api/admin/transactions/:id/cancel'");
const to = source.indexOf("app.post('/api/admin/users/:id/cancel-limit/reset'", from);
assert.ok(from >= 0 && to > from);
const route = source.slice(from, to);

function fixture({ failureAt = null, notificationOk = true } = {}) {
  const calls = [], failure = new Error('fixture private DB failure');
  let handler, committed = false, mutations = 0, notifications = 0, releases = 0;
  const tx = { id: '30', client_id: '20', status: 'cancelled', cancelled_by: '10', cancel_reason: 'Fixture cancellation' };
  const pool = { async connect() { return {
    async query(sql) {
      calls.push(sql);
      if ((failureAt === 'begin' && sql === 'BEGIN') || (failureAt === 'commit' && sql === 'COMMIT')) throw failure;
      if (sql === 'COMMIT') committed = true;
    }, release() { releases++; }
  }; } };
  new Function('app', 'authRequired', 'requireRole', 'normalizeRequestKey', 'pool', 'cancelCompletedTransaction',
    'getProfile', 'sendTelegramMessage', 'transactionResponse', 'console', route)(
    { post(path, ...handlers) { handler = handlers.at(-1); } }, () => {}, () => () => {}, normalizeRequestKey, pool,
    async () => {
      if (failureAt === 'cancel') throw Object.assign(failure, { statusCode: 409 });
      const replay = committed; if (!replay) mutations++;
      return { ...tx, __idempotentReplay: replay };
    },
    async () => { if (failureAt === 'profile') throw failure; return { id: '20', telegramId: 'fixture', balance: 100 }; },
    async () => { notifications++; return { ok: notificationOk }; }, row => row, { error() {} });
  return {
    calls, failure, handler,
    get committed() { return committed; }, get mutations() { return mutations; },
    get notifications() { return notifications; }, get releases() { return releases; },
    async invoke(body = {}) {
      const replies = [], errors = [];
      const res = { status(code) { this.code = code; return this; }, json(value) { replies.push({ status: this.code || 200, body: value }); } };
      await handler({ params: { id: '30' }, user: { id: '10' }, body: { reason: 'Fixture cancellation', requestKey: 'committed-cancellation-key', ...body } }, res, error => errors.push(error));
      return { replies, errors };
    }
  };
}

test('owner cancellation: profile failure after confirmed COMMIT reports saved cancellation without rollback', async () => {
  const h = fixture({ failureAt: 'profile' }), result = await h.invoke();
  assert.deepEqual(result.errors, []);
  assert.equal(result.replies[0].status, 503);
  assert.equal(result.replies[0].body.code, 'cancellation_committed');
  assert.equal(result.replies[0].body.cancelled, true);
  assert.equal(result.replies[0].body.transaction.status, 'cancelled');
  assert.match(result.replies[0].body.error, /Операция уже отменена/);
  assert.doesNotMatch(JSON.stringify(result.replies), /private DB/);
  assert.equal(h.committed, true); assert.equal(h.mutations, 1); assert.equal(h.releases, 1);
  assert.deepEqual(h.calls, ['BEGIN', 'COMMIT']);
  const repeated = await h.invoke();
  assert.equal(repeated.replies[0].body.cancelled, true);
  assert.equal(h.mutations, 1); assert.equal(h.notifications, 0);
});

test('owner cancellation: failed/uncertain COMMIT never reports confirmed cancellation', async () => {
  for (const failureAt of ['begin', 'cancel', 'commit']) {
    const h = fixture({ failureAt }), result = await h.invoke();
    assert.equal(h.committed, false); assert.equal(h.releases, 1);
    assert.ok(h.calls.includes('ROLLBACK'));
    if (failureAt === 'cancel') assert.equal(result.replies[0].status, 409);
    else assert.deepEqual(result.errors, [h.failure]);
    assert.ok(result.replies.every(reply => reply.body.cancelled !== true));
    assert.equal(h.notifications, 0);
  }
});

test('owner cancellation: success/replay contract and provider non-success remain unchanged', async () => {
  for (const notificationOk of [true, false]) {
    const h = fixture({ notificationOk });
    const first = await h.invoke(), repeated = await h.invoke();
    for (const result of [first, repeated]) {
      assert.deepEqual(result.errors, []); assert.equal(result.replies[0].status, 200);
      assert.equal(result.replies[0].body.ok, true); assert.equal(result.replies[0].body.client.id, '20');
      assert.equal(result.replies[0].body.code, undefined);
    }
    assert.equal(h.mutations, 1); assert.equal(h.notifications, 1); assert.equal(h.releases, 2);
    assert.ok(!h.calls.includes('ROLLBACK'));
  }
});

test('owner cancellation: invalid reason/key are rejected before transaction', async () => {
  const h = fixture();
  for (const body of [{ reason: 'x' }, { requestKey: '' }]) assert.equal((await h.invoke(body)).replies[0].status, 400);
  assert.equal(h.committed, false); assert.equal(h.releases, 0); assert.deepEqual(h.calls, []);
});

test('owner cancellation HTTP: actual client retry and gateway preserve confirmed cancellation message', async t => {
  const h = fixture({ failureAt: 'profile' }), app = express(); app.use(express.json());
  app.post('/api/admin/transactions/:id/cancel', (req, res, next) => { req.user = { id: '10' }; next(); }, h.handler);
  const child = app.listen(0, '127.0.0.1'); await once(child, 'listening');
  t.after(() => new Promise(resolve => child.close(resolve)));
  const gateway = await readFile(new URL('../universal-server.js', import.meta.url), 'utf8');
  const from = gateway.indexOf('async function readRequestBody('), to = gateway.indexOf('export async function renderAppIndex(');
  assert.ok(from >= 0 && to > from);
  const proxy = new Function('http', 'internalPort', 'childReady', 'MAX_BODY_BYTES', 'canonicalizeSessionToken', gateway.slice(from, to) + '\nreturn proxyRequest;')(
    http, child.address().port, true, 1024 * 1024, async token => ({ token, payload: {} }));
  const publicServer = http.createServer((req, res) => proxy(req, res));
  publicServer.listen(0, '127.0.0.1'); await once(publicServer, 'listening');
  t.after(() => new Promise(resolve => publicServer.close(resolve)));
  const client = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const apiStart = client.indexOf('function timeoutError('), apiEnd = client.indexOf('function openModal(', apiStart);
  assert.ok(apiStart >= 0 && apiEnd > apiStart);
  const api = new Function('state', 'APP_VERSION', 'IS_VK', 'API_TIMEOUT_MS', 'delay', client.slice(apiStart, apiEnd) + '\nreturn api;')(
    { token: 'fixture' }, 'fixture', false, 3000, async () => {});
  await assert.rejects(api(`http://127.0.0.1:${publicServer.address().port}/api/admin/transactions/30/cancel`, {
    method: 'POST', body: JSON.stringify({ reason: 'Fixture cancellation', requestKey: 'committed-http-key' })
  }), error => error.status === 503 && error.payload.code === 'cancellation_committed'
    && error.payload.cancelled === true && /Операция уже отменена/.test(error.message));
  assert.equal(h.mutations, 1); assert.equal(h.releases, 2); assert.equal(h.notifications, 0);
  assert.deepEqual(h.calls, ['BEGIN', 'COMMIT', 'BEGIN', 'COMMIT']);
});
