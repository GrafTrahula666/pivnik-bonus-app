// Manual diagnostic only: exact disabled draft routes, never imported at startup.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { signSession, verifySession, effectiveRoleForAuthenticatedIdentity } from '../platform-core.js';

const pinned = '776c70d691540b01bbc56a1496203e6cc918eea6';
const draft = execFileSync('git', ['show', `${pinned}:universal-server.js`], { encoding: 'utf8' });
const local = await readFile(new URL('../universal-server.js', import.meta.url), 'utf8');
function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing anchors: ${start}`);
  return source.slice(from, to);
}
const boundary = section(local, 'async function canonicalizeSessionToken(', 'async function ensurePersonalQr(');
assert.equal(boundary, section(draft, 'async function canonicalizeSessionToken(', 'async function ensurePersonalQr('));
const routes = section(draft, "    if (req.method === 'GET' && url.pathname === '/api/admin/pos/dashboard')", "    if (req.method === 'GET' && url.pathname === '/api/admin/users')");
const scratch = await mkdtemp(path.join(tmpdir(), 'pos-signed-service-'));
const hashes = {};
await writeFile(path.join(scratch, 'package.json'), '{"type":"module"}');
for (const file of ['pos/service.js', 'pos/analytics.js', 'pos/evotor-client.js', 'pos/evotor-document.js',
  'pos/repository.js', 'pos/sync.js', 'qr-resolver.js', 'platform-core.js', 'migrations/012_evotor_sales.sql', 'test/fixtures/evotor.js']) {
  const bytes = execFileSync('git', ['show', `${pinned}:${file}`]);
  hashes[file] = createHash('sha256').update(bytes).digest('hex');
  await mkdir(path.dirname(path.join(scratch, file)), { recursive: true });
  await writeFile(path.join(scratch, file), bytes);
}
const { createPosService } = await import(pathToFileURL(path.join(scratch, 'pos/service.js')));
const { sale } = await import(pathToFileURL(path.join(scratch, 'test/fixtures/evotor.js')));
const receipt = sale({ id: 'receipt', close_date: new Date().toISOString() });
receipt.body.result_sum = '10.00'; receipt.body.positions[0].result_sum = '10.00'; receipt.body.payments[0].payment.sum = '10.00';
const nativeFetch = globalThis.fetch;
let providerStatus = 200, providerCalls = 0, truncateReply = false;
const db = new PGlite();
const secret = 'disposable-session-secret';
const terms = 'fixture-terms';
const calls = [];
const cases = [];
let unavailable = false;
const pool = { query: async (...args) => {
  if (unavailable) throw new Error('fixture database unavailable');
  if (sqlIncludes(args, 'pg_try_advisory_lock')) return { rows: [{ locked: true }], rowCount: 1 };
  if (sqlIncludes(args, 'pg_advisory_unlock')) return { rows: [], rowCount: 0 };
  const result = await db.query(...args);
  return { ...result, rowCount: result.rows.length };
} };
function sqlIncludes(args, text) { return args[0].includes(text); }
pool.connect = async () => ({ query: pool.query, release() {} });
await db.exec(`CREATE TABLE users (id BIGINT PRIMARY KEY, role TEXT, session_version INTEGER,
  merged_into_user_id BIGINT, deleted_at TIMESTAMPTZ, terms_accepted_at TIMESTAMPTZ, terms_version TEXT,
  qr_token TEXT, qr_short_code TEXT);
  CREATE TABLE user_identities (user_id BIGINT, provider TEXT, provider_user_id TEXT);
  INSERT INTO users(id,role,session_version,terms_accepted_at,terms_version) VALUES (1,'admin',1,NOW(),'fixture-terms');
  INSERT INTO users(id,qr_token,qr_short_code) VALUES (2,'ClientToken_123456789','PVK-AAAA-2222'),(3,'OtherToken_123456789','PVK-BBBB-3333');
  INSERT INTO user_identities VALUES (1,'telegram','101'),(1,'vk','202');
  CREATE TABLE qr_aliases(qr_token TEXT,qr_short_code TEXT,user_id BIGINT,source_user_id BIGINT);
  CREATE TABLE wallets(user_id BIGINT PRIMARY KEY,balance BIGINT);
  CREATE TABLE transactions(client_id BIGINT,status TEXT,check_amount_cents BIGINT,created_at TIMESTAMPTZ);
  INSERT INTO wallets VALUES (1,1000),(2,2000),(3,3000);`);
await db.exec(await readFile(path.join(scratch, 'migrations/012_evotor_sales.sql'), 'utf8'));
const service = createPosService(pool, { enabled: true, token: 'fixture-provider-token', storeId: 'bar' });
const context = vm.createContext({ pool, verifySession: token => verifySession(token, secret),
  effectiveRoleForAuthenticatedIdentity, ownerTelegramId: '101', ownerVkId: '202', TERMS_VERSION: terms,
  sendJson: (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); },
  readRequestBody: async (req, limit) => { let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > limit) throw Object.assign(new Error('too large'), { statusCode: 413 }); } return body; },
  parseJsonBody: body => { try { return JSON.parse(body); } catch { throw Object.assign(new Error('invalid JSON'), { statusCode: 400 }); } },
  posService: Object.fromEntries(['dashboard', 'sync', 'link'].map(name => [name, async (user, input) => {
    calls.push({ name, id: user.id, platform: user.platform, role: user.role, input });
    return service[name](user, input);
  }]))
});
vm.runInContext(`${boundary}\nasync function dispatch(req,res,url) {${routes}\n throw Object.assign(new Error('not found'), {statusCode:404});}\n globalThis.dispatch=dispatch;`, context);
const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/provider')) {
      assert.equal(req.headers.authorization, 'Bearer fixture-provider-token'); providerCalls++;
      return context.sendJson(res, providerStatus, providerStatus === 200 ? { items: [receipt], paging: {} } : { error: 'fixture' });
    }
    if (truncateReply && req.url === '/api/admin/pos/link') {
      truncateReply = false;
      const send = res.end.bind(res); res.end = () => send('{"ok":');
    }
    await context.dispatch(req, res, new URL(req.url, 'http://localhost'));
  }
  catch (error) { context.sendJson(res, error.statusCode || 503, { error: error.message }); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
globalThis.fetch = (input, options) => {
  const url = new URL(input);
  if (url.origin === 'https://api.evotor.ru') {
    assert.equal(url.pathname, '/stores/bar/documents');
    return nativeFetch(origin + '/provider' + url.search, options);
  }
  assert.equal(url.origin, origin, 'external network forbidden');
  return nativeFetch(input, options);
};
const signed = (platform, overrides = {}) => signSession({ uid: '1', sv: 1, platform,
  pid: platform === 'vk' ? '202' : '101', exp: Date.now() + 60000, ...overrides }, secret);
async function check(name, platform, expected, overrides = {}, options = {}) {
  const before = calls.length;
  const snapshot = async () => JSON.stringify((await db.query('SELECT * FROM users ORDER BY id')).rows)
    + JSON.stringify((await db.query('SELECT * FROM user_identities ORDER BY provider')).rows);
  const dataBefore = await snapshot();
  const financialBefore = await financialSnapshot(options.syncStateChanges);
  const providerBefore = providerCalls;
  const token = options.token ?? signed(platform, overrides);
  const path = options.path || 'link';
  const response = await fetch(`${origin}/api/admin/pos/${path}`, {
    method: path === 'dashboard' ? 'GET' : 'POST',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'x-platform': platform === 'vk' ? 'telegram' : 'vk',
      'content-type': 'application/json' },
    ...(path === 'dashboard' ? {} : { body: options.body ?? JSON.stringify({ documentId: 'receipt', qr: 'PVK-AAAA-2222' }) })
  });
  const result = await response.json();
  assert.equal(response.status, expected, name);
  assert.equal(calls.length - before, options.serviceCalls ?? (expected === 200 ? 1 : 0), `${name}: service calls`);
  assert.equal(await snapshot(), dataBefore, `${name}: identity data unchanged`);
  if (expected !== 200) assert.equal(await financialSnapshot(options.syncStateChanges), financialBefore, `${name}: financial/audit state unchanged`);
  if ((options.serviceCalls ?? (expected === 200 ? 1 : 0)) === 0) assert.equal(providerCalls, providerBefore, `${name}: no provider request`);
  if (expected === 200) {
    assert.equal(calls.at(-1).platform, platform, 'header cannot switch signed identity');
    assert.equal(calls.at(-1).id, '1');
  }
  cases.push(`${platform}: ${name}`);
  return result;
}
async function financialSnapshot(excludeSyncState = false) {
  const tables = ['pos_documents', 'pos_customer_links', ...(!excludeSyncState ? ['pos_sync_state'] : []), 'wallets', 'transactions'];
  return JSON.stringify(await Promise.all(tables.map(async table => (await db.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows)));
}
async function untouchedJournal() {
  assert.deepEqual((await db.query('SELECT * FROM wallets ORDER BY user_id')).rows,
    [{ user_id: 1, balance: 1000 }, { user_id: 2, balance: 2000 }, { user_id: 3, balance: 3000 }]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM transactions')).rows[0].n, 0);
}
try {
  for (const platform of ['telegram', 'vk']) {
    await db.exec('DELETE FROM pos_customer_links; DELETE FROM pos_documents; DELETE FROM pos_sync_state;');
    for (const path of ['dashboard', 'sync', 'link']) await check(`authorized ${path}`, platform, 200, {}, { path });
    await check('repeat dispatch rechecks session', platform, 200);
    await check('missing bearer', platform, 401, {}, { token: '' });
    await check('forged signature', platform, 401, {}, { token: signed(platform) + 'x' });
    await check('wrong signing secret', platform, 401, {}, { token: signSession({ uid: '1', sv: 1,
      platform, pid: platform === 'vk' ? '202' : '101', exp: Date.now() + 60000 }, 'wrong-secret') });
    await check('signed invalid user id', platform, 401, { uid: 'not-a-number' });
    await check('signed invalid version', platform, 401, { sv: 1.5 });
    await check('staff token cannot act as owner', platform, 401, { kind: 'staff', terminalUid: '1',
      terminalSv: 1, staffUid: '999', staffSv: 1 });
    await check('expired token', platform, 401, { exp: Date.now() - 1 });
    await check('wrong version', platform, 401, { sv: 2 });
    await check('missing provider id', platform, 401, { pid: '' });
    await check('other platform provider id', platform, 401, { pid: platform === 'vk' ? '101' : '202' });
    await check('other user id', platform, 401, { uid: '999' });
    await check('invalid JSON after authorization', platform, 400, {}, { body: '{' });
    await check('oversized body', platform, 413, {}, { body: 'x'.repeat(8193) });
    await db.exec('UPDATE users SET session_version=2 WHERE id=1');
    await check('revoked session', platform, 401);
    await db.exec('UPDATE users SET session_version=1, deleted_at=NOW() WHERE id=1');
    await check('deleted actor', platform, 401);
    await db.exec('UPDATE users SET deleted_at=NULL, merged_into_user_id=9 WHERE id=1');
    await check('merged actor', platform, 401);
    await db.exec('UPDATE users SET merged_into_user_id=NULL, terms_version=\'old\' WHERE id=1');
    await check('outdated consent', platform, 428);
    await db.exec("UPDATE users SET terms_version='fixture-terms', role='viewer' WHERE id=1");
    // Remove configured owner override to test stored permissions.
    context.ownerTelegramId = '999'; context.ownerVkId = '999';
    await check('viewer read', platform, 200, {}, { path: 'dashboard' });
    await check('viewer sync denied', platform, 403, {}, { path: 'sync' });
    await check('viewer link denied', platform, 403);
    await check('permission before body parsing', platform, 403, {}, { body: '{' });
    await db.exec("UPDATE users SET role='client' WHERE id=1");
    await check('client read denied', platform, 403, {}, { path: 'dashboard' });
    unavailable = true;
    await check('identity database unavailable', platform, 503);
    unavailable = false;
    await db.exec("UPDATE users SET role='admin' WHERE id=1");
    context.ownerTelegramId = '101'; context.ownerVkId = '202';
    const projection = await check('confirmed loyalty projection', platform, 200, {}, { path: 'dashboard' });
    assert.equal(projection.all.netCents, '1000'); assert.equal(projection.app.netCents, '1000');
    const saved = await financialSnapshot();
    await check('original QR replay', platform, 200);
    assert.equal(await financialSnapshot(), saved);
    await check('other QR cannot reassign', platform, 409, {}, { serviceCalls: 1,
      body: JSON.stringify({ documentId: 'receipt', qr: 'PVK-BBBB-3333' }) });
    await check('invalid service input', platform, 400, {}, { serviceCalls: 1,
      body: JSON.stringify({ documentId: 7, qr: 'PVK-AAAA-2222' }) });
    await check('unknown QR', platform, 404, {}, { serviceCalls: 1,
      body: JSON.stringify({ documentId: 'receipt', qr: 'PVK-ZZZZ-9999' }) });
    await db.exec('DELETE FROM pos_customer_links');
    await db.exec('ALTER TABLE pos_customer_links ADD CONSTRAINT fixture_link_refusal CHECK (client_id <> 2)');
    await check('link SQL failure rolls back', platform, 503, {}, { serviceCalls: 1 });
    await db.exec('ALTER TABLE pos_customer_links DROP CONSTRAINT fixture_link_refusal');
    // Commit succeeds, but the local HTTP adapter truncates the response.
    const command = JSON.stringify({ documentId: 'receipt', qr: 'PVK-AAAA-2222' });
    truncateReply = true;
    const lost = await fetch(origin + '/api/admin/pos/link', { method: 'POST',
      headers: { authorization: `Bearer ${signed(platform)}`, 'content-type': 'application/json' }, body: command });
    assert.equal(lost.status, 200); await assert.rejects(() => lost.json());
    const committed = await financialSnapshot();
    const links = (await db.query('SELECT * FROM pos_customer_links')).rows;
    assert.equal(links.length, 1); assert.equal(links[0].client_id, 2); assert.equal(links[0].confirmed_by, 1); assert.ok(links[0].confirmed_at);
    cases.push(`${platform}: committed link with unreadable response`);
    await db.exec('UPDATE users SET session_version=2 WHERE id=1');
    await check('revoked session after uncertain commit', platform, 401, {}, { body: command });
    assert.equal(await financialSnapshot(), committed);
    await db.exec('UPDATE users SET session_version=1 WHERE id=1');
    const recovered = await check('authorized original command recovery', platform, 200, {}, { body: command });
    assert.equal(recovered.clientId, '2'); assert.equal(await financialSnapshot(), committed);
    providerStatus = 401;
    await check('provider failure preserves cash and audit', platform, 502, {}, { path: 'sync', serviceCalls: 1, syncStateChanges: true });
    providerStatus = 200;
    const stale = await check('cached projection after provider refusal', platform, 200, {}, { path: 'dashboard' });
    assert.equal(stale.all.netCents, '1000'); assert.equal(stale.app.netCents, '1000'); assert.equal(stale.connection.state, 'error');
    assert.deepEqual((await db.query('SELECT * FROM pos_customer_links')).rows, links);
    await untouchedJournal();
  }
  assert.equal((await db.query('SELECT count(*) AS n FROM user_identities')).rows[0].n, 2);
  process.stdout.write(JSON.stringify({ pinned, boundaryHash: createHash('sha256').update(boundary).digest('hex'),
    routesHash: createHash('sha256').update(routes).digest('hex'), passed: cases.length, cases,
    sourceHashes: hashes, providerCalls, limits: 'Real gateway session/SQL, pinned routes and actual POS service. Fixture DDL/secret/HTTP/body/provider and stubbed advisory locks. No auth issuance, tenant, real fiscal samples or concurrent PostgreSQL proof.' }, null, 2) + '\n');
} finally {
  globalThis.fetch = nativeFetch;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await db.close();
  await rm(scratch, { recursive: true, force: true });
}
