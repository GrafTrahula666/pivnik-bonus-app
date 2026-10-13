import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { createSpaceverseCustomerAuth } from '../spaceverse-customer-auth.js';
import { createSpaceverseCustomerHttp, createSpaceverseSignedIdentityVerifier } from '../routes/spaceverse-customer.js';
import { createSpaceverseRuntimeManifest, resolveSpaceverseRuntime } from '../spaceverse-runtime-manifest.js';
import { isAutomaticStartupMigration } from '../migration-startup-policy.js';
import { signSession, verifySession } from '../platform-core.js';

const sessionSecret = 'synthetic-spaceverse-session-secret-2026';
const botToken = 'synthetic-spaceverse-telegram-bot-token';
const vkSecret = 'synthetic-spaceverse-vk-app-secret';
const requestKey = () => crypto.randomUUID();
const identity = (providerUserId = '101') => ({ provider: 'telegram', providerUserId, firstName: 'Тест',
  lastName: null, username: 'synthetic', photoUrl: null });

async function fixture(seed = 'a', companyId = '700', venueId = '701') {
  const db = new PGlite();
  await db.exec(`CREATE TABLE users(id BIGSERIAL PRIMARY KEY,telegram_id BIGINT UNIQUE,username TEXT,
    first_name TEXT NOT NULL,last_name TEXT,photo_url TEXT,role TEXT NOT NULL DEFAULT 'client',
    session_version BIGINT NOT NULL DEFAULT 1,deleted_at TIMESTAMPTZ,merged_into_user_id BIGINT);
    CREATE TABLE wallets(user_id BIGINT PRIMARY KEY REFERENCES users(id),balance BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE user_identities(id BIGSERIAL PRIMARY KEY,user_id BIGINT REFERENCES users(id),provider TEXT,
      provider_user_id TEXT,provider_username TEXT,UNIQUE(provider,provider_user_id),UNIQUE(user_id,provider));`);
  for (const name of ['017_spaceverse_runtime_binding.sql', '018_spaceverse_runtime_scope_binding.sql',
    '019_spaceverse_customer_ownership.sql', '020_spaceverse_customer_auth_requests.sql']) {
    await db.exec(await fs.readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  const manifest = createSpaceverseRuntimeManifest({ draftId: `${seed.repeat(8)}-${seed.repeat(4)}-4${seed.repeat(3)}-8${seed.repeat(3)}-${seed.repeat(12)}`,
    runtimeKey: `sv-${seed.repeat(32)}`, draftRevision: 1, applicationRevision: 1, scopeRevision: 1,
    scope: { companyId, venueId }, config: { displayName: 'Тестовое заведение', theme: 'light',
      primaryColor: '#112233', secondaryColor: '#445566', shopEnabled: false, loyaltyEnabled: true } });
  await db.query(`INSERT INTO spaceverse_runtime_binding
    (singleton,runtime_key,manifest_sha256,manifest_revision,company_id,venue_id)
    VALUES(TRUE,$1,$2,1,$3,$4)`, [manifest.runtimeKey, manifest.manifestSha256, companyId, venueId]);
  const query = db.query.bind(db);
  const pool = { query, connect: async () => ({ query, release() {} }) };
  const runtime = await resolveSpaceverseRuntime({ environment: { SPACEVERSE_RUNTIME_MODE: 'tenant',
    SPACEVERSE_RUNTIME_MANIFEST_JSON: JSON.stringify(manifest) }, query });
  const auth = createSpaceverseCustomerAuth({ runtime, query, connect: pool.connect,
    verifyIdentity: async value => value, sessionSecret });
  return { db, query, pool, runtime, auth, manifest };
}
function telegramCredentials(id = '101') {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: Number(id), first_name: 'Тест', username: 'synthetic' }) });
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(sorted).digest('hex'));
  return { platform: 'telegram', initData: params.toString() };
}
function vkCredentials(id = '101') {
  const params = new URLSearchParams({ vk_app_id: '123', vk_user_id: id, vk_ts: String(Math.floor(Date.now() / 1000)) });
  const sorted = new URLSearchParams([...params.entries()].sort(([a], [b]) => a.localeCompare(b))).toString();
  params.set('sign', crypto.createHmac('sha256', vkSecret).update(sorted).digest('base64url'));
  return { platform: 'vk', launchParams: params.toString() };
}
async function mounted(f, mode) {
  const handle = createSpaceverseCustomerHttp({ runtime: f.runtime, pool: f.pool, sessionSecret,
    telegramBotToken: botToken, vkAppId: '123', vkAppSecret: vkSecret });
  let legacyCalls = 0;
  let server;
  if (mode === 'express') {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { handle(req, res).then(handled => { if (!handled) next(); }).catch(next); });
    app.use((_req, res) => { legacyCalls += 1; res.status(418).json({ legacy: true }); });
    server = http.createServer(app);
  } else server = http.createServer(async (req, res) => {
    if (await handle(req, res)) return;
    legacyCalls += 1; res.writeHead(418); res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { request: async (path, { method = 'GET', body, token, headers = {} } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }, legacyCalls: () => legacyCalls, close: () => new Promise(resolve => server.close(resolve)) };
}

test('tenant auth creates canonical user, zero wallet, ownership and exact replay atomically', async () => {
  const f = await fixture();
  try {
    const input = { requestKey: requestKey(), credentials: identity() };
    const first = await f.auth.authenticate(input);
    const replay = await f.auth.authenticate(input);
    const next = await f.auth.authenticate({ ...input, requestKey: requestKey() });
    assert.equal(first.profile.wallet.balance, '0');
    assert.equal(replay.profile.customer.id, first.profile.customer.id);
    assert.equal(next.profile.customer.id, first.profile.customer.id);
    for (const table of ['users', 'wallets', 'user_identities', 'spaceverse_customer_ownership']) {
      assert.equal((await f.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count, 1);
    }
    assert.equal((await f.query('SELECT count(*)::int AS count FROM spaceverse_customer_auth_requests')).rows[0].count, 2);
    assert.equal(first.runtimeStatus, 'not_provisioned');
    await assert.rejects(f.auth.authenticate({ ...input, credentials: identity('102') }), { code: 'SPACEVERSE_AUTH_REPLAY_CONFLICT' });
    assert.equal((await f.query('SELECT count(*)::int AS count FROM users')).rows[0].count, 1);
    await f.query('UPDATE wallets SET balance=125');
    assert.equal((await f.auth.authorize(first.token)).wallet.balance, '125');
    assert.equal((await f.auth.authenticate(input)).profile.wallet.balance, '125');
  } finally { await f.db.close(); }
});

test('tenant auth rolls back all new rows on receipt failure and replays an uncertain COMMIT', async () => {
  const f = await fixture();
  try {
    let failReceipt = true, uncertainCommit = false;
    const auth = createSpaceverseCustomerAuth({ runtime: f.runtime, query: f.query,
      verifyIdentity: async value => value, sessionSecret, connect: async () => ({
        query: async (sql, params) => {
          if (failReceipt && sql.includes('INSERT INTO spaceverse_customer_auth_requests')) throw new Error('synthetic audit store failure');
          const result = await f.query(sql, params);
          if (uncertainCommit && sql === 'COMMIT') { uncertainCommit = false; throw new Error('synthetic lost reply'); }
          return result;
        }, release() {}
      }) });
    const input = { requestKey: requestKey(), credentials: identity() };
    await assert.rejects(auth.authenticate(input), { code: 'SPACEVERSE_AUTH_UNAVAILABLE' });
    assert.equal((await f.query('SELECT count(*)::int AS count FROM users')).rows[0].count, 0);
    failReceipt = false; uncertainCommit = true;
    await assert.rejects(auth.authenticate(input), { code: 'SPACEVERSE_AUTH_UNAVAILABLE' });
    const recovered = await auth.authenticate(input);
    assert.equal(recovered.profile.wallet.balance, '0');
    assert.equal((await f.query('SELECT count(*)::int AS count FROM users')).rows[0].count, 1);
    assert.equal((await f.query('SELECT count(*)::int AS count FROM spaceverse_customer_auth_requests')).rows[0].count, 1);
  } finally { await f.db.close(); }
});

test('historical identities are never attached and missing wallets are not zero balances', async () => {
  const f = await fixture();
  try {
    await f.db.exec(`INSERT INTO users(id,first_name) VALUES(90,'Исторический');
      INSERT INTO user_identities(user_id,provider,provider_user_id) VALUES(90,'telegram','9090');
      INSERT INTO wallets(user_id,balance) VALUES(90,99999);`);
    await assert.rejects(f.auth.authenticate({ requestKey: requestKey(), credentials: identity('9090') }), { code: 'SPACEVERSE_AUTH_CUSTOMER_NOT_OWNED' });
    assert.equal((await f.query('SELECT balance::text FROM wallets WHERE user_id=90')).rows[0].balance, '99999');
    assert.equal((await f.query('SELECT count(*)::int AS count FROM spaceverse_customer_ownership')).rows[0].count, 0);
    await f.query(`INSERT INTO spaceverse_customer_ownership(user_id,runtime_key,company_id,venue_id)
      VALUES(90,$1,'700','701')`, [f.manifest.runtimeKey]);
    await f.db.exec("INSERT INTO users(id,first_name) VALUES(91,'Без кошелька'); INSERT INTO user_identities(user_id,provider,provider_user_id) VALUES(91,'vk','9191')");
    await f.query(`INSERT INTO spaceverse_customer_ownership(user_id,runtime_key,company_id,venue_id)
      VALUES(91,$1,'700','701')`, [f.manifest.runtimeKey]);
    await assert.rejects(f.auth.authenticate({ requestKey: requestKey(), credentials: { ...identity('9191'), provider: 'vk' } }), { code: 'SPACEVERSE_AUTH_WALLET_MISSING' });
  } finally { await f.db.close(); }
});

test('two tenants and two venues in one company reject cross-session and cross-database auth', async () => {
  const a = await fixture('a', '700', '701');
  const b = await fixture('b', '700', '702');
  const c = await fixture('c', '800', '801');
  try {
    const signed = await Promise.all([a, b, c].map(f => f.auth.authenticate({ requestKey: requestKey(), credentials: identity() })));
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) if (i !== j) {
        await assert.rejects([a, b, c][j].auth.authorize(signed[i].token), { code: 'SPACEVERSE_AUTH_SESSION_INVALID' });
      }
    }
    const cross = createSpaceverseCustomerAuth({ runtime: a.runtime, query: b.query, connect: b.pool.connect,
      verifyIdentity: async value => value, sessionSecret });
    await assert.rejects(cross.authenticate({ requestKey: requestKey(), credentials: identity('202') }), { code: 'SPACEVERSE_AUTH_BINDING_REJECTED' });
    for (const extra of [{ tenantId: '800' }, { venueId: '702' }, { runtime: b.runtime }, { role: 'admin' }]) {
      await assert.rejects(a.auth.authenticate({ requestKey: requestKey(), credentials: identity(), ...extra }), { code: 'SPACEVERSE_RUNTIME_REQUEST_SCOPE_FORBIDDEN' });
    }
    assert.throws(() => createSpaceverseCustomerAuth({ runtime: { ...a.runtime }, query: a.query, connect: a.pool.connect,
      verifyIdentity: async value => value, sessionSecret }), { code: 'SPACEVERSE_RUNTIME_CONTEXT_UNVERIFIED' });
  } finally { await Promise.all([a, b, c].map(f => f.db.close())); }
});

test('tenant sessions recheck binding, identity, role, session version and deleted/merged state', async () => {
  const f = await fixture();
  try {
    const signed = await f.auth.authenticate({ requestKey: requestKey(), credentials: identity() });
    for (const change of ["role='admin'", 'session_version=2', 'deleted_at=NOW()', 'merged_into_user_id=id']) {
      await f.query(`UPDATE users SET ${change}`);
      await assert.rejects(f.auth.authorize(signed.token), { code: 'SPACEVERSE_AUTH_SESSION_INVALID' });
      await f.db.exec("UPDATE users SET role='client',session_version=1,deleted_at=NULL,merged_into_user_id=NULL");
    }
    const claims = verifySession(signed.token, sessionSecret);
    for (const patch of [{ pid: 'foreign' }, { pid: '102' }, { companyId: '800' }, { venueId: '702' }, { exp: 1 }, { sv: '999999999999999999999' }]) {
      await assert.rejects(f.auth.authorize(signSession({ ...claims, ...patch }, sessionSecret)), { code: 'SPACEVERSE_AUTH_SESSION_INVALID' });
    }
    await f.query("UPDATE spaceverse_runtime_binding SET manifest_sha256=$1", ['f'.repeat(64)]);
    await assert.rejects(f.auth.authorize(signed.token), { code: 'SPACEVERSE_AUTH_SESSION_INVALID' });
    await assert.rejects(f.auth.authenticate({ requestKey: requestKey(), credentials: identity() }), { code: 'SPACEVERSE_AUTH_BINDING_REJECTED' });
  } finally { await f.db.close(); }
});

test('shared real HTTP adapters enforce signed Telegram/VK auth and wallet isolation in both runtimes', async () => {
  const f = await fixture();
  try {
    for (const mode of ['express', 'gateway']) {
      const app = await mounted(f, mode);
      try {
        for (const credentials of [telegramCredentials(), vkCredentials()]) {
          const body = { requestKey: requestKey(), ...credentials };
          const login = await app.request('/api/auth', { method: 'POST', body });
          assert.equal(login.status, 200);
          assert.equal(login.body.profile.wallet.balance, '0');
          const token = login.body.token;
          assert.equal((await app.request('/api/me', { token })).status, 200);
          const balance = await app.request('/api/wallet/balance', { token });
          assert.equal(balance.body.hasData, true);
          assert.equal(balance.body.wallet.balance, '0');
          assert.equal((await app.request('/api/wallet/config', { token })).body.status, 'not_configured');
          assert.equal((await app.request('/api/wallet/apple', { token })).status, 503);
          assert.equal((await app.request('/api/me?companyId=800', { token })).status, 400);
          assert.equal((await app.request('/api/me', { token, headers: { 'x-venue-id': '702' } })).status, 400);
          assert.equal((await app.request('/api/wallet/balance')).status, 401);
          assert.equal((await app.request('/api/auth', { method: 'POST', body: { ...body, role: 'admin' } })).status, 400);
          const forged = { ...body, ...(credentials.platform === 'telegram' ? { initData: 'forged' } : { launchParams: 'forged' }) };
          assert.equal((await app.request('/api/auth', { method: 'POST', body: forged })).status, 401);
        }
        assert.equal((await app.request('/api/staff/transactions', { method: 'POST', body: {} })).status, 503);
        assert.equal(app.legacyCalls(), 0, 'tenant API cannot fall through to PIVNIK handlers');
      } finally { await app.close(); }
    }
    assert.equal((await f.query('SELECT count(*)::int AS count FROM users')).rows[0].count, 2, 'provider identities stay separate');
  } finally { await f.db.close(); }
});

test('new auth migration is manual/additive and both production mounts remain behind startup guard', async () => {
  const migration = await fs.readFile(new URL('../migrations/020_spaceverse_customer_auth_requests.sql', import.meta.url), 'utf8');
  assert.equal(isAutomaticStartupMigration('020_spaceverse_customer_auth_requests.sql'), false);
  assert.doesNotMatch(migration, /^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/im);
  assert.doesNotMatch(migration, /ALTER TABLE\s+(?:users|wallets|purchases)/i);
  for (const name of ['server.js', 'universal-server.js']) {
    const source = await fs.readFile(new URL('../' + name, import.meta.url), 'utf8');
    assert.match(source, /createSpaceverseCustomerHttp/);
    assert.match(source, /const runtime = await guardSpaceverseRuntimeStartup/);
    assert.ok(source.indexOf('await guardSpaceverseRuntimeStartup') < source.indexOf('spaceverseCustomerHttp = createSpaceverseCustomerHttp'));
  }
  const manifest = await fs.readFile(new URL('../spaceverse-runtime-manifest.js', import.meta.url), 'utf8');
  assert.match(manifest, /startAllowed: false/);
  const verifier = createSpaceverseSignedIdentityVerifier({ telegramBotToken: botToken });
  await assert.rejects(verifier({ ...telegramCredentials(), userId: '999', tenantId: '800' }), { code: 'SPACEVERSE_RUNTIME_REQUEST_SCOPE_FORBIDDEN' });
});
