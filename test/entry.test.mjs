import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpsServer } from 'node:https';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createEntry } from '../server.mjs';

let folder, ca, key;
const openServers = new Set();
before(async () => {
  folder = await mkdtemp(join(process.cwd(), '.test-tls-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(folder, 'key.pem'), '-out', join(folder, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
  ca = await readFile(join(folder, 'cert.pem')); key = await readFile(join(folder, 'key.pem'));
});
after(async () => {
  for (const server of openServers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await rm(folder, { recursive: true, force: true });
});

async function listen(server, secure = false) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  openServers.add(server);
  return `${secure ? 'https' : 'http'}://127.0.0.1:${server.address().port}`;
}
async function fixture(reply, options = {}) {
  const requests = [];
  const upstream = await listen(createHttpsServer({ key, cert: ca }, async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    requests.push({ url: req.url, method: req.method, headers: req.headers, body });
    reply(req, res);
  }), true);
  const entry = await listen(createEntry({ origin: upstream, ca, ...options }));
  return { entry, upstream, requests };
}
const post = (base, path, payload, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload) });
const endJson = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Set-Cookie': 'fixture=discard', 'X-Railway-Request-Id': 'fixture-trace' }); res.end(JSON.stringify(body)); };

test('readiness works without an upstream call and does not imply upstream success', async () => {
  const f = await fixture((_req, res) => endJson(res, 500, {}));
  const r = await fetch(f.entry + '/ready');
  assert.equal(r.status, 200); assert.equal((await r.json()).upstreamVerified, false); assert.equal(f.requests.length, 0);
});

test('fixed routes reject unrelated paths, query strings and wrong HTTP methods before forwarding', async () => {
  const f = await fixture((_req, res) => endJson(res, 200, { ok: true }));
  for (const path of ['/api/admin/users', '/api/health?url=https://other.invalid', '//other.invalid/api/health', '/api/device/pos/qr/%72esolve']) {
    assert.equal((await fetch(f.entry + path)).status, 404);
  }
  const wrong = await fetch(f.entry + '/api/device/pos/qr/resolve');
  assert.equal(wrong.status, 405); assert.equal(wrong.headers.get('allow'), 'POST'); assert.equal(f.requests.length, 0);
});

test('keyless check preserves the actual backend401 JSON without forwarding Evotor authorization or cookies', async () => {
  const refusal = { ok: false, error: 'device_auth_required' };
  const f = await fixture((_req, res) => endJson(res, 401, refusal));
  const r = await post(f.entry, '/api/device/pos/qr/resolve', { payload: 'PIVNIK-CONNECTION-CHECK' }, { Authorization: 'Bearer fixture-evotor', Cookie: 'session=fixture', 'X-Forwarded-Host': 'other.invalid' });
  assert.equal(r.status, 401); assert.deepEqual(await r.json(), refusal);
  assert.equal(r.headers.get('cache-control'), 'no-store'); assert.equal(r.headers.get('set-cookie'), null);
  assert.equal(r.headers.get('x-railway-request-id'), 'fixture-trace');
  const received = f.requests[0];
  assert.equal(received.headers.authorization, undefined); assert.equal(received.headers.cookie, undefined); assert.equal(received.headers['x-forwarded-host'], undefined); assert.equal(received.headers['x-pivnik-device-key'], undefined);
  assert.equal(received.headers.host, new URL(f.upstream).host);
});

test('binding preserves device-key, JSON bytes and receipt UUID exactly, and forwards only once', async () => {
  const f = await fixture((_req, res) => endJson(res, 201, { ok: true, status: 'bound' }));
  const payload = { receiptUuid: '12345678-1234-4321-abcd-1234567890ab', payload: 'PIVNIK:fixture_customer' };
  const r = await post(f.entry, '/api/device/pos/receipts/bind', payload, { 'X-Pivnik-Device-Key': 'pvpos_fixture_key' });
  assert.equal(r.status, 201); assert.deepEqual(await r.json(), { ok: true, status: 'bound' });
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].headers['x-pivnik-device-key'], 'pvpos_fixture_key');
  assert.equal(f.requests[0].body, JSON.stringify(payload)); assert.equal(f.requests[0].method, 'POST'); assert.equal(f.requests[0].url, '/api/device/pos/receipts/bind');
});

test('health preserves backend status and cannot fabricate a successful origin response', async () => {
  const f = await fixture((_req, res) => endJson(res, 503, { ok: false, database: 'unavailable' }));
  const r = await fetch(f.entry + '/api/health'); assert.equal(r.status, 503); assert.deepEqual(await r.json(), { ok: false, database: 'unavailable' });
});

test('nonJSON and oversized request bodies are rejected without contacting backend', async () => {
  const f = await fixture((_req, res) => endJson(res, 200, { ok: true }));
  const wrong = await fetch(f.entry + '/api/device/pos/qr/resolve', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'fixture' });
  assert.equal(wrong.status, 415);
  const large = await post(f.entry, '/api/device/pos/qr/resolve', { payload: 'x'.repeat(17 * 1024) });
  assert.equal(large.status, 413); assert.equal(f.requests.length, 0);
});

test('backend redirects are refused without sending a key to the redirect target', async () => {
  const f = await fixture((_req, res) => { res.writeHead(307, { Location: 'https://other.invalid/steal' }); res.end(); });
  const r = await post(f.entry, '/api/device/pos/qr/resolve', { payload: 'PIVNIK:fixture' }, { 'X-Pivnik-Device-Key': 'pvpos_fixture_key' });
  assert.equal(r.status, 502); assert.equal((await r.json()).error, 'entry_upstream_redirect'); assert.equal(f.requests.length, 1);
});

test('untrusted upstream TLS certificate fails closed', async () => {
  const f = await fixture((_req, res) => endJson(res, 200, { ok: true }), { ca: undefined });
  const r = await fetch(f.entry + '/api/health'); assert.equal(r.status, 502); assert.equal(f.requests.length, 0);
});

test('upstream timeout is bounded and never retried, including receipt bind', async () => {
  const f = await fixture(() => {}, { timeoutMs: 100 });
  const r = await post(f.entry, '/api/device/pos/receipts/bind', { receiptUuid: 'fixture', payload: 'PIVNIK:fixture' });
  assert.equal(r.status, 504); assert.equal((await r.json()).error, 'entry_upstream_timeout'); assert.equal(f.requests.length, 1);
});

test('upstream response size is bounded', async () => {
  const f = await fixture((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('x'.repeat(65 * 1024)); });
  const r = await fetch(f.entry + '/api/health'); assert.equal(r.status, 502); assert.equal((await r.json()).error, 'entry_upstream_too_large');
});

test('insecure or nonorigin upstream configuration is refused', () => {
  for (const origin of ['http://example.invalid', 'https://user:password@example.invalid', 'https://example.invalid/path', 'https://example.invalid?query=1']) assert.throws(() => createEntry({ origin }));
});

test('backend failure passes through once, without retrying a receipt binding', async () => {
  const f = await fixture((_req, res) => endJson(res, 503, { ok: false, error: 'fixture_busy' }));
  const r = await post(f.entry, '/api/device/pos/receipts/bind', { receiptUuid: 'fixture', payload: 'PIVNIK:fixture' });
  assert.equal(r.status, 503); assert.equal(f.requests.length, 1);
});

test('concurrency limit rejects excess work and is released after the first response', async () => {
  let enteredResolve, release, count = 0;
  const entered = new Promise(resolve => { enteredResolve = resolve; });
  const f = await fixture((_req, res) => {
    count++;
    if (count === 1) { release = () => endJson(res, 200, { ok: true }); enteredResolve(); }
    else endJson(res, 200, { ok: true });
  }, { maxConcurrent: 1 });
  const first = fetch(f.entry + '/api/health'); await entered;
  assert.equal((await fetch(f.entry + '/api/health')).status, 503); assert.equal(f.requests.length, 1);
  release(); assert.equal((await first).status, 200);
  assert.equal((await fetch(f.entry + '/api/health')).status, 200); assert.equal(f.requests.length, 2);
});

test('oversized key header is refused before an upstream request', async () => {
  const f = await fixture((_req, res) => endJson(res, 200, { ok: true }));
  const r = await post(f.entry, '/api/device/pos/qr/resolve', { payload: 'PIVNIK:fixture' }, { 'X-Pivnik-Device-Key': 'x'.repeat(1025) });
  assert.equal(r.status, 400); assert.equal(f.requests.length, 0);
});
