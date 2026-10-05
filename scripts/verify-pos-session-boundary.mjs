// Manual diagnostic only: exact disabled draft routes, never imported at startup.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
const db = new PGlite();
const secret = 'disposable-session-secret';
const terms = 'fixture-terms';
const calls = [];
const cases = [];
let unavailable = false;
const pool = { query: async (...args) => {
  if (unavailable) throw new Error('fixture database unavailable');
  const result = await db.query(...args);
  return { ...result, rowCount: result.rows.length };
} };
await db.exec(`CREATE TABLE users (id BIGINT PRIMARY KEY, role TEXT, session_version INTEGER,
  merged_into_user_id BIGINT, deleted_at TIMESTAMPTZ, terms_accepted_at TIMESTAMPTZ, terms_version TEXT);
  CREATE TABLE user_identities (user_id BIGINT, provider TEXT, provider_user_id TEXT);
  INSERT INTO users VALUES (1,'admin',1,NULL,NULL,NOW(),'fixture-terms');
  INSERT INTO user_identities VALUES (1,'telegram','101'),(1,'vk','202');`);
const context = vm.createContext({ pool, verifySession: token => verifySession(token, secret),
  effectiveRoleForAuthenticatedIdentity, ownerTelegramId: '101', ownerVkId: '202', TERMS_VERSION: terms,
  sendJson: (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); },
  readRequestBody: async (req, limit) => { let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > limit) throw Object.assign(new Error('too large'), { statusCode: 413 }); } return body; },
  parseJsonBody: body => { try { return JSON.parse(body); } catch { throw Object.assign(new Error('invalid JSON'), { statusCode: 400 }); } },
  posService: Object.fromEntries(['dashboard', 'sync', 'link'].map(name => [name, async (user, input) => {
    calls.push({ name, id: user.id, platform: user.platform, role: user.role, input });
    return { ok: true, actor: user.id, platform: user.platform };
  }]))
});
vm.runInContext(`${boundary}\nasync function dispatch(req,res,url) {${routes}\n throw Object.assign(new Error('not found'), {statusCode:404});}\n globalThis.dispatch=dispatch;`, context);
const server = http.createServer(async (req, res) => {
  try { await context.dispatch(req, res, new URL(req.url, 'http://localhost')); }
  catch (error) { context.sendJson(res, error.statusCode || 503, { error: error.message }); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const signed = (platform, overrides = {}) => signSession({ uid: '1', sv: 1, platform,
  pid: platform === 'vk' ? '202' : '101', exp: Date.now() + 60000, ...overrides }, secret);
async function check(name, platform, expected, overrides = {}, options = {}) {
  const before = calls.length;
  const snapshot = async () => JSON.stringify((await db.query('SELECT * FROM users ORDER BY id')).rows)
    + JSON.stringify((await db.query('SELECT * FROM user_identities ORDER BY provider')).rows);
  const dataBefore = await snapshot();
  const token = options.token ?? signed(platform, overrides);
  const path = options.path || 'link';
  const response = await fetch(`${origin}/api/admin/pos/${path}`, {
    method: path === 'dashboard' ? 'GET' : 'POST',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'x-platform': platform === 'vk' ? 'telegram' : 'vk',
      'content-type': 'application/json' },
    ...(path === 'dashboard' ? {} : { body: options.body ?? JSON.stringify({ documentId: 'receipt', qr: 'fixture' }) })
  });
  await response.json();
  assert.equal(response.status, expected, name);
  assert.equal(calls.length - before, expected === 200 ? 1 : 0, `${name}: service calls`);
  assert.equal(await snapshot(), dataBefore, `${name}: identity data unchanged`);
  if (expected === 200) {
    assert.equal(calls.at(-1).platform, platform, 'header cannot switch signed identity');
    assert.equal(calls.at(-1).id, '1');
  }
  cases.push(`${platform}: ${name}`);
}
try {
  for (const platform of ['telegram', 'vk']) {
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
    await db.exec('UPDATE users SET session_version=2');
    await check('revoked session', platform, 401);
    await db.exec('UPDATE users SET session_version=1, deleted_at=NOW()');
    await check('deleted actor', platform, 401);
    await db.exec('UPDATE users SET deleted_at=NULL, merged_into_user_id=9');
    await check('merged actor', platform, 401);
    await db.exec('UPDATE users SET merged_into_user_id=NULL, terms_version=\'old\'');
    await check('outdated consent', platform, 428);
    await db.exec("UPDATE users SET terms_version='fixture-terms', role='viewer'");
    // Remove configured owner override to test stored permissions.
    context.ownerTelegramId = '999'; context.ownerVkId = '999';
    await check('viewer read', platform, 200, {}, { path: 'dashboard' });
    await check('viewer sync denied', platform, 403, {}, { path: 'sync' });
    await check('viewer link denied', platform, 403);
    await check('permission before body parsing', platform, 403, {}, { body: '{' });
    await db.exec("UPDATE users SET role='client'");
    await check('client read denied', platform, 403, {}, { path: 'dashboard' });
    unavailable = true;
    await check('identity database unavailable', platform, 503);
    unavailable = false;
    await db.exec("UPDATE users SET role='admin'");
    context.ownerTelegramId = '101'; context.ownerVkId = '202';
  }
  assert.equal((await db.query('SELECT count(*) AS n FROM user_identities')).rows[0].n, 2);
  process.stdout.write(JSON.stringify({ pinned, boundaryHash: createHash('sha256').update(boundary).digest('hex'),
    routesHash: createHash('sha256').update(routes).digest('hex'), passed: cases.length, cases,
    limits: 'Real gateway session/SQL and pinned route guards; fixture DDL, secret, body/HTTP adapters, service spy. No auth issuance, real POS money/provider, tenant or concurrent PostgreSQL proof.' }, null, 2) + '\n');
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await db.close();
}
