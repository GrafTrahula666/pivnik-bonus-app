import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { normalizeRequestKey } from '../platform-core.js';

const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
function between(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing source anchors: ${start}`);
  return source.slice(from, to);
}
const auth = between('async function authRequired(', 'async function resolveActingStaff(');
const routes = {
  staff: between("app.post('/api/staff/transactions/:id/cancel'", "app.get('/api/staff/transactions/:id'"),
  admin: between("app.post('/api/admin/transactions/:id/cancel'", "app.post('/api/admin/users/:id/cancel-limit/reset'")
};

function fixture(kind, { failureAt, replay = false, quota = { active: true, remaining: 3, countFrom: 'fixture' } } = {}) {
  const calls = [], failure = new Error(`fixture ${failureAt}`);
  let saved = replay;
  let handlers, connections = 0, releases = 0, mutations = 0, notifications = 0;
  const tx = { status: 'cancelled', id: '30', client_id: '20', cancelled_by: '10', cancel_reason: 'Fixture reason' };
  const profile = { id: '20', telegramId: 'fixture', balance: 100 };
  const client = {
    async query(sql) { calls.push(sql); if ((failureAt === 'begin' && sql === 'BEGIN') || (failureAt === 'commit' && sql === 'COMMIT')) throw failure; if (sql === 'COMMIT') saved = true; return { rows: [], rowCount: 0 }; },
    release() { releases++; }
  };
  const pool = {
    async query(sql) {
      if (sql.includes('session_version')) return { rows: [{ session_version: 1 }], rowCount: 1 };
      calls.push(sql);
      if (failureAt === 'replay') throw failure;
      return { rows: saved ? [tx] : [], rowCount: saved ? 1 : 0 };
    },
    async connect() { connections++; if (failureAt === 'connect') throw failure; return client; }
  };
  const wire = new Function('app', 'pool', 'verifySession', 'getProfile', 'effectiveRoleForAuthenticatedIdentity',
    'ownerTelegramId', 'ownerVkId', 'normalizeRequestKey', 'resolveActingStaff', 'transactionResponse',
    'unlimitedCancellationQuota', 'getCancellationQuota', 'cancelCompletedTransaction', 'sendTelegramMessage', 'console', auth + routes[kind]);
  wire({ post(path, ...items) { handlers = items; } }, pool,
    token => ['admin', 'staff', 'viewer', 'client'].includes(token) ? { uid: '10', sv: 1, pid: token } : null,
    async id => {
      if (String(id) === '10') return { id: '10', role: 'client' };
      if (failureAt === 'profile') throw failure;
      return profile;
    }, (role, platform, pid) => pid, null, null, normalizeRequestKey,
    async req => { if (failureAt === 'staff-session') throw failure; return req.user; },
    row => row, () => ({ unlimited: true }), async (id, db) => { if (failureAt === 'quota' && !db) throw failure; return quota; },
    async (db, id, actor, reason, key, options) => {
      calls.push({ id, actor, reason, key, options });
      if (failureAt === 'cancel') throw Object.assign(failure, { statusCode: 409 });
      if (!replay) mutations++;
      return { ...tx, __idempotentReplay: replay };
    }, async () => { notifications++; return { ok: false }; }, { error() {} });
  return {
    handlers, calls, failure,
    get connections() { return connections; }, get releases() { return releases; },
    get mutations() { return mutations; }, get notifications() { return notifications; },
    async invoke({ token = kind, body = {}, id = '30' } = {}) {
      const replies = [], errors = [];
      const req = { headers: { authorization: `Bearer ${token}` }, params: { id }, body: { reason: 'Fixture reason', requestKey: 'cancellation-fixture-key', ...body } };
      const res = { status(code) { this.code = code; return this; }, json(value) { replies.push({ status: this.code || 200, body: value }); } };
      for (const fn of handlers) {
        let proceed = false;
        await fn(req, res, error => { if (error) errors.push(error); else proceed = true; });
        if (!proceed) break;
      }
      return { replies, errors };
    }
  };
}


test('staff cancellation: profile/quota failure after COMMIT reports saved reversal and safe replay', async () => {
  for (const failureAt of ['profile', 'quota']) {
    const h = fixture('staff', { failureAt });
    for (let attempt = 0; attempt < 2; attempt++) {
      const { replies, errors } = await h.invoke();
      assert.deepEqual(errors, []);
      assert.equal(replies[0].status, 503);
      assert.equal(replies[0].body.code, 'cancellation_committed');
      assert.equal(replies[0].body.cancelled, true);
      assert.equal(replies[0].body.transaction.status, 'cancelled');
      assert.match(replies[0].body.error, /Операция уже отменена/);
      assert.doesNotMatch(JSON.stringify(replies), /fixture (profile|quota)/);
    }
    assert.equal(h.mutations, 1); assert.equal(h.connections, 1); assert.equal(h.releases, 1);
    assert.equal(h.calls.filter(x => x === 'COMMIT').length, 1);
    assert.ok(!h.calls.includes('ROLLBACK'));
    assert.equal(h.notifications, failureAt === 'profile' ? 0 : 1);
  }
});

test('staff cancellation: existing replay failure confirms only matching actor/reason/transaction', async () => {
  for (const failureAt of ['profile', 'quota']) {
    const h = fixture('staff', { replay: true, failureAt });
    assert.equal((await h.invoke()).replies[0].body.cancelled, true);
    for (const options of [{ id: '31' }, { body: { reason: 'Different reason' } }]) {
      const result = await h.invoke(options);
      assert.equal(result.replies[0].status, 409);
      assert.equal(result.replies[0].body.cancelled, undefined);
    }
    assert.equal(h.mutations, 0); assert.equal(h.connections, 0); assert.equal(h.notifications, 0);
  }
});

test('staff cancellation: pre-COMMIT failures never claim confirmation and retain rollback', async () => {
  for (const failureAt of ['begin', 'cancel', 'commit']) {
    const h = fixture('staff', { failureAt }), result = await h.invoke();
    if (failureAt === 'cancel') assert.equal(result.replies[0].status, 409);
    else assert.deepEqual(result.errors, [h.failure]);
    assert.ok(!result.replies.some(x => x.body.cancelled));
    assert.ok(h.calls.includes('ROLLBACK')); assert.equal(h.releases, 1);
    assert.equal(h.notifications, 0);
  }
});

test('staff cancellation: auth/input/quota denials do not mutate', async () => {
  const h = fixture('staff');
  assert.equal((await h.invoke({ token: '' })).replies[0].status, 401);
  assert.equal((await h.invoke({ token: 'viewer' })).replies[0].status, 403);
  for (const body of [{ reason: 'x' }, { requestKey: '' }]) assert.equal((await h.invoke({ body })).replies[0].status, 400);
  assert.equal(h.connections, 0); assert.equal(h.mutations, 0);
  for (const quota of [{ active: false, remaining: 3 }, { active: true, remaining: 0 }]) {
    const denied = fixture('staff', { quota });
    assert.equal((await denied.invoke()).replies[0].status, 403);
    assert.equal(denied.mutations, 0); assert.ok(denied.calls.includes('ROLLBACK'));
  }
});

test('staff cancellation: successful response and replay preserve quota/notification/owner bypass', async () => {
  const h = fixture('staff');
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await h.invoke(); assert.equal(result.replies[0].status, 200);
    assert.equal(result.replies[0].body.ok, true); assert.equal(result.replies[0].body.quota.remaining, 3);
  }
  assert.equal(h.mutations, 1); assert.equal(h.notifications, 1);
  const owner = fixture('staff', { quota: { active: false, remaining: 0 }, failureAt: 'quota' });
  assert.deepEqual((await owner.invoke({ token: 'admin' })).replies[0].body.quota, { unlimited: true });
  assert.deepEqual(owner.calls.find(x => typeof x === 'object').options, {});
});
test('staff cancellation HTTP: actual client retry and gateway preserve confirmed cancellation message', async t => {
  const h = fixture('staff', { failureAt: 'quota' }), app = express(); app.use(express.json());
  app.post('/api/staff/transactions/:id/cancel', ...h.handlers);
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
    { token: 'staff' }, 'fixture', false, 3000, async () => {});
  await assert.rejects(api(`http://127.0.0.1:${publicServer.address().port}/api/staff/transactions/30/cancel`, {
    method: 'POST', body: JSON.stringify({ reason: 'Fixture reason', requestKey: 'committed-http-key' })
  }), error => error.status === 503 && error.payload.code === 'cancellation_committed'
    && error.payload.cancelled === true && /Операция уже отменена/.test(error.message));
  assert.equal(h.mutations, 1); assert.equal(h.releases, 1); assert.equal(h.notifications, 1);
  assert.equal(h.connections, 1); assert.ok(!h.calls.includes('ROLLBACK'));
});
