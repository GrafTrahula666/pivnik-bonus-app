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
  let handlers, connections = 0, releases = 0, mutations = 0, notifications = 0;
  const tx = { id: '30', client_id: '20', cancelled_by: '10', cancel_reason: 'Fixture reason' };
  const profile = { id: '20', telegramId: 'fixture', balance: 100 };
  const client = {
    async query(sql) { calls.push(sql); if (failureAt === 'begin' && sql === 'BEGIN') throw failure; return { rows: [], rowCount: 0 }; },
    release() { releases++; }
  };
  const pool = {
    async query(sql) {
      if (sql.includes('session_version')) return { rows: [{ session_version: 1 }], rowCount: 1 };
      calls.push(sql);
      if (failureAt === 'replay') throw failure;
      return { rows: replay ? [tx] : [], rowCount: replay ? 1 : 0 };
    },
    async connect() { connections++; if (failureAt === 'connect') throw failure; return client; }
  };
  const wire = new Function('app', 'pool', 'verifySession', 'getProfile', 'effectiveRoleForAuthenticatedIdentity',
    'ownerTelegramId', 'ownerVkId', 'normalizeRequestKey', 'resolveActingStaff', 'transactionResponse',
    'unlimitedCancellationQuota', 'getCancellationQuota', 'cancelCompletedTransaction', 'sendTelegramMessage', auth + routes[kind]);
  wire({ post(path, ...items) { handlers = items; } }, pool,
    token => ['admin', 'staff', 'viewer', 'client'].includes(token) ? { uid: '10', sv: 1, pid: token } : null,
    async id => {
      if (String(id) === '10') return { id: '10', role: 'client' };
      if (failureAt === 'profile') throw failure;
      return profile;
    }, (role, platform, pid) => pid, null, null, normalizeRequestKey,
    async req => { if (failureAt === 'staff-session') throw failure; return req.user; },
    row => row, () => ({ unlimited: true }), async () => quota,
    async (db, id, actor, reason, key, options) => {
      calls.push({ id, actor, reason, key, options });
      if (failureAt === 'cancel') throw Object.assign(failure, { statusCode: 409 });
      if (!replay) mutations++;
      return { ...tx, __idempotentReplay: replay };
    }, async () => { notifications++; });
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

test('cancellation: pool rejection reaches next for owner and staff before mutation', async () => {
  for (const kind of ['admin', 'staff']) {
    const h = fixture(kind, { failureAt: 'connect' }), result = await h.invoke();
    assert.deepEqual(result.errors, [h.failure]); assert.deepEqual(result.replies, []);
    assert.equal(h.connections, 1); assert.equal(h.releases, 0);
    assert.equal(h.mutations, 0); assert.equal(h.notifications, 0);
  }
});

test('staff cancellation: PIN/replay/profile preflight failures reach next without acquiring client', async () => {
  for (const failureAt of ['staff-session', 'replay', 'profile']) {
    const h = fixture('staff', { failureAt, replay: failureAt === 'profile' });
    assert.deepEqual((await h.invoke()).errors, [h.failure]);
    assert.equal(h.connections, 0); assert.equal(h.mutations, 0); assert.equal(h.notifications, 0);
  }
});

test('cancellation: BEGIN and cancellation errors retain rollback/release and conflict response', async () => {
  for (const kind of ['admin', 'staff']) for (const failureAt of ['begin', 'cancel']) {
    const h = fixture(kind, { failureAt }), result = await h.invoke();
    if (failureAt === 'begin') assert.deepEqual(result.errors, [h.failure]);
    else assert.equal(result.replies[0].status, 409);
    assert.ok(h.calls.includes('ROLLBACK')); assert.equal(h.releases, 1);
    assert.equal(h.mutations, 0); assert.equal(h.notifications, 0);
  }
});

test('cancellation: authentication, role and input rejection precede connection', async () => {
  for (const kind of ['admin', 'staff']) {
    const h = fixture(kind);
    assert.equal((await h.invoke({ token: '' })).replies[0].status, 401);
    assert.equal((await h.invoke({ token: 'viewer' })).replies[0].status, 403);
    if (kind === 'admin') assert.equal((await h.invoke({ token: 'staff' })).replies[0].status, 403);
    for (const body of [{ reason: 'x' }, { requestKey: '' }]) assert.equal((await h.invoke({ body })).replies[0].status, 400);
    assert.equal(h.connections, 0); assert.equal(h.mutations, 0);
  }
});

test('cancellation: success and existing replay keep response, actor, reason, quota and notification rules', async () => {
  for (const kind of ['admin', 'staff']) for (const replay of [false, true]) {
    const h = fixture(kind, { replay }), result = await h.invoke();
    assert.deepEqual(result.errors, []); assert.equal(result.replies[0].status, 200);
    assert.equal(result.replies[0].body.ok, true);
    assert.equal(result.replies[0].body.transaction.cancelled_by, '10');
    assert.equal(result.replies[0].body.transaction.cancel_reason, 'Fixture reason');
    assert.equal(h.mutations, replay ? 0 : 1); assert.equal(h.notifications, replay ? 0 : 1);
    assert.equal(h.connections, kind === 'staff' && replay ? 0 : 1);
    if (kind === 'staff') assert.equal(result.replies[0].body.quota.remaining, 3);
    else assert.equal(result.replies[0].body.quota, undefined);
  }
  for (const options of [{ id: '31' }, { body: { reason: 'Changed reason' } }]) {
    const h = fixture('staff', { replay: true });
    assert.equal((await h.invoke(options)).replies[0].status, 409);
    assert.equal(h.connections, 0); assert.equal(h.mutations, 0); assert.equal(h.notifications, 0);
  }
  const owner = fixture('staff', { quota: { active: false, remaining: 0 } });
  assert.deepEqual((await owner.invoke({ token: 'admin' })).replies[0].body.quota, { unlimited: true });
});

test('staff cancellation: inactive/exhausted quota still denies with rollback', async () => {
  for (const quota of [{ active: false, remaining: 3 }, { active: true, remaining: 0 }]) {
    const h = fixture('staff', { quota });
    assert.equal((await h.invoke()).replies[0].status, 403);
    assert.ok(h.calls.includes('ROLLBACK')); assert.equal(h.releases, 1);
    assert.equal(h.mutations, 0); assert.equal(h.notifications, 0);
  }
});

test('cancellation HTTP: owner/staff pool failures return 500 through actual gateway proxy', async t => {
  const app = express(); app.use(express.json());
  for (const kind of ['admin', 'staff']) app.post(`/api/${kind}/transactions/:id/cancel`, ...fixture(kind, { failureAt: 'connect' }).handlers);
  app.use((error, req, res, next) => res.status(500).json({ error: 'Fixture server failure' }));
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
  for (const kind of ['admin', 'staff']) {
    const response = await fetch(`http://127.0.0.1:${publicServer.address().port}/api/${kind}/transactions/30/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', authorization: `Bearer ${kind}` },
      body: JSON.stringify({ reason: 'Fixture reason', requestKey: 'fixture-http-cancellation' }), signal: AbortSignal.timeout(3000)
    });
    assert.equal(response.status, 500); assert.deepEqual(await response.json(), { error: 'Fixture server failure' });
  }
});
