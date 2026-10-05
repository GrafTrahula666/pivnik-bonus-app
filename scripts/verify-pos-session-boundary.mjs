// Manual diagnostic only: exact disabled draft routes, never imported at startup.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { GOLD_BARS_FRAME, giftedFrameChoices, PERSONAL_FRAME_OWNERSHIP_SQL } from '../personal-profile-frames.js';
import { signSession, verifySession, effectiveRoleForAuthenticatedIdentity, isConfiguredOwnerIdentity,
  validateVkLaunchParams, validateTelegramInitData } from '../platform-core.js';

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
let unavailable = false, queryCalls = 0, failProfile = false, failedProfileActor = null;
const pool = { query: async (...args) => {
  queryCalls++;
  if (unavailable) throw new Error('fixture database unavailable');
  if (failProfile && sqlIncludes(args, 'SELECT u.*, w.balance, bl.paid_ml_total')) {
    failProfile = false; failedProfileActor = String(args[1][0]);
    // Fail the actual profile SELECT, after account provisioning has committed.
    return db.query(args[0].replace('FROM users u', 'FROM fixture_missing_profile_relation u'), args[1]);
  }
  if (sqlIncludes(args, 'pg_try_advisory_lock')) return { rows: [{ locked: true }], rowCount: 1 };
  if (sqlIncludes(args, 'pg_advisory_unlock')) return { rows: [], rowCount: 0 };
  if (sqlIncludes(args, 'pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
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
await db.exec(`ALTER TABLE users ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (START WITH 10);
  ALTER TABLE users ALTER COLUMN session_version SET DEFAULT 1;
  ALTER TABLE users ADD COLUMN telegram_id BIGINT, ADD COLUMN username TEXT, ADD COLUMN first_name TEXT,
    ADD COLUMN last_name TEXT, ADD COLUMN photo_url TEXT, ADD COLUMN language_code TEXT,
    ADD COLUMN onboarding_completed_at TIMESTAMPTZ, ADD COLUMN unlimited_bonus BOOLEAN,
    ADD COLUMN profile_frame TEXT, ADD COLUMN updated_at TIMESTAMPTZ;
  ALTER TABLE user_identities ADD COLUMN provider_username TEXT, ADD COLUMN profile_url TEXT, ADD COLUMN updated_at TIMESTAMPTZ;
  CREATE UNIQUE INDEX fixture_identity_unique ON user_identities(provider,provider_user_id);
  CREATE TABLE beer_loyalty(user_id BIGINT PRIMARY KEY, paid_ml_total BIGINT DEFAULT 0, gift_ml_balance BIGINT DEFAULT 0);
  CREATE TABLE user_frames(user_id BIGINT, frame_id TEXT);`);
// Materialized auth claims optional tester gifts. Execute the original no-recipient
// path with an empty fixture table, without seeding real handles or bonus grants.
const recipientsDDL = await readFile(new URL('../migrations/007_red_cosmos_v2.sql', import.meta.url), 'utf8');
await db.exec(section(recipientsDDL, 'CREATE TABLE IF NOT EXISTS pending_special_achievement_recipients', 'INSERT INTO pending_special_achievement_recipients'));
const claimsSQL = await readFile(new URL('../migrations/008_tester_recipient_aliases.sql', import.meta.url), 'utf8');
await db.exec(claimsSQL.slice(claimsSQL.indexOf('CREATE OR REPLACE FUNCTION pivnik_claim_pending_special_achievement')));
hashes['local-recipient-table-DDL'] = createHash('sha256').update(section(recipientsDDL,
  'CREATE TABLE IF NOT EXISTS pending_special_achievement_recipients', 'INSERT INTO pending_special_achievement_recipients')).digest('hex');
hashes['local-claim-function-SQL'] = createHash('sha256').update(claimsSQL.slice(claimsSQL.indexOf('CREATE OR REPLACE FUNCTION pivnik_claim_pending_special_achievement'))).digest('hex');
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
const authSource = [
  section(local, 'function safeText(', 'function makeShortCode('),
  section(local, 'function signSession(', 'function rubles('),
  section(local, 'function validateVkLaunchParams(', 'async function waitForChild('),
  section(local, 'async function canonicalUserId(', 'async function canonicalizeSessionToken('),
  section(local, 'async function ensureAuthRecords(', 'async function ensureSupplementalRecords('),
  section(local, 'async function resolveProviderUser(', 'async function grantReward(')
].join('\n');
Object.assign(context, { signCoreSession: signSession, verifyCoreSession: verifySession, sessionSecret: secret,
  SESSION_TTL_MS: 60000, Date, validateCoreVkLaunchParams: validateVkLaunchParams,
  validateCoreTelegramInitData: validateTelegramInitData, vkAppId: '54694987', vkAppSecret: 'fixture-vk-secret',
  telegramBotToken: 'fixture-bot-token', VK_AUTH_MAX_AGE_SECONDS: 86400, allowDemo: false,
  isConfiguredOwnerIdentity, traceVkStage() {}, setImmediate() {},
  annaTelegramId: '', GOLD_BARS_FRAME, giftedFrameChoices, PERSONAL_FRAME_OWNERSHIP_SQL });
const profileSource = [
  section(local, "const BAR_CODE =", 'const MIGRATION_CHECKSUM_UPGRADES'),
  section(local, 'const STATUS_LEVELS =', 'if (!databaseUrl)'),
  section(local, 'function rubles(', 'function validateVkLaunchParams('),
  section(local, 'async function getProfile(', 'const PROFILE_AVATAR_SOURCES'),
  section(local, 'async function getAppPayload(', 'async function ensureAuthRecords(')
].join('\n');
vm.runInContext(profileSource, context);
vm.runInContext(`${authSource}\nglobalThis.login=body=>body.platform==='vk'?authenticateVk(body):authenticateTelegram(body);`, context);
const limiterSource = section(local, 'function requestAddress(', 'function configuredMutationOrigins(');
const authRoute = section(local, "    if (req.method === 'POST' && url.pathname === '/api/auth')", "    if (req.method === 'GET' && url.pathname === '/api/bootstrap')");
let fixtureNow = null;
class FixtureDate extends Date { static now() { return fixtureNow ?? Date.now(); } }
Object.assign(context, { Date: FixtureDate, platformReady: true, releaseCommit: 'fixture',
  validBootId: () => null, createVkStartupTrace: () => () => {}, withVkStartupTrace: (_trace, fn) => fn(),
  safeStartupCode: error => error.code || 'fixture-error', console: { error() {}, log() {}, warn() {} } });
vm.runInContext(`const rateLimitBuckets=new Map();${limiterSource}\nasync function dispatchAuth(req,res,url){${authRoute}}\nglobalThis.dispatchAuth=dispatchAuth;globalThis.clearFixtureLimits=()=>rateLimitBuckets.clear();`, context);
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/api/auth') {
      return await context.dispatchAuth(req, res, new URL(req.url, 'http://localhost'));
    }
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
function launch(platform, id, timestamp = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams(platform === 'vk'
    ? { vk_app_id: '54694987', vk_user_id: id, vk_ts: String(timestamp), vk_language: 'ru', vk_platform: 'mobile_web' }
    : { auth_date: String(timestamp), query_id: 'fixture-query', user: JSON.stringify({ id: Number(id), first_name: 'Fixture' }) });
  const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const signature = platform === 'vk'
    ? createHmac('sha256', 'fixture-vk-secret').update(new URLSearchParams(entries).toString()).digest('base64url')
    : createHmac('sha256', createHmac('sha256', 'WebAppData').update('fixture-bot-token').digest())
      .update(entries.map(([key, value]) => `${key}=${value}`).join('\n')).digest('hex');
  params.set(platform === 'vk' ? 'sign' : 'hash', signature);
  return { platform, [platform === 'vk' ? 'launchParams' : 'initData']: params.toString() };
}
async function authSnapshot() {
  return JSON.stringify(await Promise.all(['users', 'user_identities', 'wallets', 'beer_loyalty', 'transactions',
    'pos_documents', 'pos_customer_links', 'pos_sync_state'].map(async table =>
    (await db.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows)));
}
async function loginCheck(name, body, expected, preDatabase = false, committed = false) {
  const before = await authSnapshot(), queryBefore = queryCalls;
  const response = await fetch(origin + '/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  assert.equal(response.status, expected, `${name}: ${data.error || ""}`);
  if (expected !== 200 && !committed) assert.equal(await authSnapshot(), before, `${name}: rollback/no writes`);
  if (preDatabase) assert.equal(queryCalls, queryBefore, `${name}: reject before DB`);
  cases.push(`${body.platform}: ${name}`);
  return data;
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
  context.ownerTelegramId = '303'; context.ownerVkId = '404';
  const issuedIds = [];
  for (const platform of ['telegram', 'vk']) {
    const id = platform === 'vk' ? '404' : '303';
    const valid = launch(platform, id), key = platform === 'vk' ? 'launchParams' : 'initData';
    await loginCheck('missing launch data', { platform }, 401, true);
    await loginCheck('demo entry disabled', { platform, demoVkId: id, demoTelegramId: id }, 401, true);
    await loginCheck('forged launch signature', { ...valid, [key]: valid[key] + 'x' }, 401, true);
    await loginCheck('expired launch data', launch(platform, id, Math.floor(Date.now() / 1000) - 86401), 401, true);
    if (platform === 'vk') await loginCheck('unsigned profile cannot switch signed VK user', { ...valid, user: { id: '999' } }, 401, true);
    unavailable = true; await loginCheck('auth identity database outage', valid, 500); unavailable = false;
    await db.exec('ALTER TABLE wallets ADD CONSTRAINT fixture_auth_refusal CHECK (balance > 0) NOT VALID');
    await loginCheck('auth wallet SQL refusal rolls back identity and actor', valid, 500);
    await db.exec('ALTER TABLE wallets DROP CONSTRAINT fixture_auth_refusal');
    const result = await loginCheck('signed provider creates owner and session', valid, 200);
    const payload = verifySession(result.token, secret);
    assert.equal(payload.platform, platform); assert.equal(payload.pid, id); assert.equal(payload.sv, 1);
    assert.equal(result.profile.role, 'admin'); issuedIds.push(payload.uid);
    assert.equal(result.startup, true); assert.equal(result.design, null);
    assert.equal(result.profile.id, payload.uid); assert.equal(result.profile.platform, platform);
    assert.equal(result.profile.balance, 9_999_999_999_999); // Existing owner display policy, not a wallet grant.
    assert.equal(result.profile.termsAccepted, false); assert.deepEqual(result.profile.achievements, []);
    assert.deepEqual(result.profile.linkedPlatforms, [platform]);
    cases.push(`${platform}: original startup owner profile and display-only unlimited balance`);
    const count = (await db.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
    const repeat = await loginCheck('re-auth reuses canonical actor', valid, 200);
    assert.equal(verifySession(repeat.token, secret).uid, payload.uid);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM users')).rows[0].n, count);
    const access = async (token, expected, name) => {
      const before = await financialSnapshot(), callsBefore = calls.length;
      const response = await fetch(origin + '/api/admin/pos/dashboard', { headers: { authorization: `Bearer ${token}` } });
      await response.json(); assert.equal(response.status, expected);
      assert.equal(calls.length - callsBefore, expected === 200 ? 1 : 0);
      assert.equal(await financialSnapshot(), before); cases.push(`${platform}: ${name}`);
    };
    await access(result.token, 428, 'issued session requires consent');
    await db.query('UPDATE users SET terms_accepted_at=NOW(),terms_version=$1 WHERE id=$2', [terms, payload.uid]);
    await access(result.token, 200, 'issued owner session admits POS after fixture consent');
    await db.query('UPDATE users SET session_version=2 WHERE id=$1', [payload.uid]);
    await access(result.token, 401, 'issued session revoked by version');
    const refreshed = await loginCheck('reauth issues current version', valid, 200);
    assert.equal(verifySession(refreshed.token, secret).sv, 2);
    await access(refreshed.token, 200, 'new issued session restores admission');
    const client = await loginCheck('non-owner signed user stays client', launch(platform, platform === 'vk' ? '888' : '777'), 200);
    assert.equal(client.profile.role, 'client');
    assert.equal(client.profile.balance, 0); assert.equal(client.profile.spend12m, 0);
    assert.equal(client.profile.status.name, 'Путник'); assert.equal(client.profile.beer.paidMlTotal, 0);
    assert.equal(client.profile.beer.giftMlBalance, 0); assert.equal(client.profile.termsAccepted, false);
    cases.push(`${platform}: original startup client profile retains zero wallet and empty loyalty`);
    const clientPayload = verifySession(client.token, secret);
    await db.query('UPDATE users SET terms_accepted_at=NOW(),terms_version=$1 WHERE id=$2', [terms, clientPayload.uid]);
    await access(client.token, 403, 'issued client session denied POS');
  }
  assert.notEqual(issuedIds[0], issuedIds[1], 'new provider owners have separate canonical actors');
  for (const platform of ['telegram', 'vk']) {
    const providerId = platform === 'vk' ? '9002' : '9001', valid = launch(platform, providerId);
    context[platform === 'vk' ? 'ownerVkId' : 'ownerTelegramId'] = providerId;
    const financialBefore = await financialSnapshot();
    failProfile = true;
    const failed = await loginCheck('profile SQL failure after account commit', valid, 500, false, true);
    assert.equal(failed.token, undefined); assert.match(failed.error, /Не удалось войти/);
    const actorId = failedProfileActor;
    const stored = async () => (await db.query(`SELECT u.id,u.role,u.session_version,w.balance,
      (SELECT count(*)::int FROM user_identities WHERE provider=$2 AND provider_user_id=$3) AS identities,
      (SELECT count(*)::int FROM beer_loyalty WHERE user_id=u.id) AS loyalty
      FROM users u JOIN wallets w ON w.user_id=u.id WHERE u.id=$1`, [actorId, platform, providerId])).rows;
    const original = await stored();
    assert.equal(original.length, 1); assert.equal(original[0].role, 'admin');
    assert.equal(original[0].balance, 0); assert.equal(original[0].identities, 1); assert.equal(original[0].loyalty, 1);
    const usersBefore = (await db.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
    const committedFinancial = await financialSnapshot();
    failProfile = true;
    const failedAgain = await loginCheck('repeated profile failure reuses committed account', valid, 500, false, true);
    assert.equal(failedAgain.token, undefined); assert.equal(failedProfileActor, actorId);
    assert.deepEqual(await stored(), original); assert.equal(await financialSnapshot(), committedFinancial);
    const key = platform === 'vk' ? 'launchParams' : 'initData';
    await loginCheck('forged repeat after committed account denied', { ...valid, [key]: valid[key] + 'x' }, 401, true);
    const recovered = await loginCheck('reauth recovers committed account without duplicate wallet', valid, 200);
    assert.equal(verifySession(recovered.token, secret).uid, actorId);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM users')).rows[0].n, usersBefore);
    assert.deepEqual(await stored(), original); assert.equal(await financialSnapshot(), committedFinancial);
    const access = async expected => {
      const response = await fetch(origin + '/api/admin/pos/dashboard', { headers: { authorization: `Bearer ${recovered.token}` } });
      await response.json(); assert.equal(response.status, expected);
      assert.equal(await financialSnapshot(), committedFinancial);
    };
    await access(428); cases.push(`${platform}: recovered session still requires consent`);
    await db.query('UPDATE users SET terms_accepted_at=NOW(),terms_version=$1 WHERE id=$2', [terms, actorId]);
    await access(200); cases.push(`${platform}: recovered owner session admits POS without financial changes`);
    // Provisioning adds one zero wallet; existing balances and POS/journal remain unchanged.
    const after = JSON.parse(await financialSnapshot());
    after[3] = after[3].filter(({ row }) => String(row.user_id) !== actorId);
    assert.deepEqual(after, JSON.parse(financialBefore));
  }
  fixtureNow = Date.now();
  for (const platform of ['telegram', 'vk']) {
    context.clearFixtureLimits();
    const invalid = { platform }, valid = launch(platform, platform === 'vk' ? '888' : '777');
    const post = async body => {
      const response = await fetch(origin + '/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    const stateBefore = await authSnapshot(), queriesBefore = queryCalls;
    for (let i = 0; i < 60; i++) assert.equal((await post(invalid)).status, 401);
    assert.equal(await authSnapshot(), stateBefore); assert.equal(queryCalls, queriesBefore);
    cases.push(`${platform}: first 60 invalid attempts reject before DB`);
    assert.equal((await post(invalid)).status, 429);
    assert.equal(await authSnapshot(), stateBefore); assert.equal(queryCalls, queriesBefore);
    cases.push(`${platform}: 61st invalid attempt rate limited without writes`);
    const other = platform === 'vk' ? 'telegram' : 'vk';
    assert.equal((await post({ platform: other })).status, 401);
    cases.push(`${platform}: invalid bucket independent from other platform`);
    // Invalid attempts do not consume the signed identity bucket.
    for (let i = 0; i < 60; i++) assert.equal((await post(valid)).status, 200);
    cases.push(`${platform}: 60 signed identity attempts remain admitted`);
    const signedBefore = await authSnapshot(), signedQueries = queryCalls;
    assert.equal((await post(valid)).status, 429);
    assert.equal(await authSnapshot(), signedBefore); assert.equal(queryCalls, signedQueries);
    cases.push(`${platform}: 61st signed identity attempt rejected before DB`);
    fixtureNow += 600000;
    assert.equal((await post(invalid)).status, 401);
    cases.push(`${platform}: invalid limit expires at exact ten-minute boundary`);
    assert.equal((await post(valid)).status, 200);
    cases.push(`${platform}: identity limit expires at exact ten-minute boundary`);
  }
  fixtureNow = null;
  assert.deepEqual((await db.query('SELECT * FROM wallets WHERE user_id < 10 ORDER BY user_id')).rows,
    [{ user_id: 1, balance: 1000 }, { user_id: 2, balance: 2000 }, { user_id: 3, balance: 3000 }]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM wallets WHERE user_id >= 10 AND balance <> 0')).rows[0].n, 0);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM transactions')).rows[0].n, 0);
  process.stdout.write(JSON.stringify({ pinned, boundaryHash: createHash('sha256').update(boundary).digest('hex'),
    profileHash: createHash('sha256').update(profileSource).digest('hex'),
    authHash: createHash('sha256').update(authSource).digest('hex'),
    limiterHash: createHash('sha256').update(limiterSource).digest('hex'),
    authRouteHash: createHash('sha256').update(authRoute).digest('hex'),
    routesHash: createHash('sha256').update(routes).digest('hex'), passed: cases.length, cases,
    sourceHashes: hashes, providerCalls, limits: 'Actual auth route/limiter/validators/account SQL/session issuance and pinned POS service. Original startup profile SQL/helpers execute. Fixture DDL/secrets/clock/HTTP/body/provider, tracing/deferred setup and advisory lock adapters. No trusted proxy/live identity/tenant/fiscal samples/concurrent PostgreSQL/full startup proof.' }, null, 2) + '\n');
} finally {
  globalThis.fetch = nativeFetch;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await db.close();
  await rm(scratch, { recursive: true, force: true });
}
