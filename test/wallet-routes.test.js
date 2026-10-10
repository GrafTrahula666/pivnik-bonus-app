import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import express from 'express';
import { registerWalletRoutes } from '../routes/wallet.js';
import { signSession, verifySession, effectiveRoleForAuthenticatedIdentity } from '../platform-core.js';

// Real checked-out route mount, auth functions and gateway proxy on loopback.
// DB/profile adapters are fixtures; this does not start the production runtimes.
const secret = 'wallet-test-only-secret';
const terms = 'wallet-test-terms';
const source = (name) => readFile(new URL('../' + name, import.meta.url), 'utf8');
function between(text, start, end) {
  const a = text.indexOf(start), b = text.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `Missing source boundary: ${start}`);
  return text.slice(a, b);
}
const token = (platform, patch = {}) => signSession({
  uid: '1', sv: 1, platform, pid: `${platform}-1`, exp: Date.now() + 60_000, ...patch
}, secret);

async function mount(config) {
  const queries = [];
  let consent = true;
  const row = { id: '1', session_version: 1, merged_into_user_id: null, deleted_at: null, role: 'client' };
  const pool = { async query(sql, args) {
    queries.push({ sql, args });
    if (String(args[0]) !== row.id) return { rowCount: 0, rows: [] };
    if (sql.includes('identity_matches')) {
      return { rowCount: 1, rows: [{ ...row, terms_accepted_at: consent ? '2026-10-10' : null,
        terms_version: terms, identity_matches: args[2] === `${args[1]}-1` }] };
    }
    assert.match(sql, /session_version/);
    return { rowCount: 1, rows: [row] };
  } };
  const globals = { pool, Buffer, URL, http, verifySession: (raw) => verifySession(raw, secret),
    effectiveRoleForAuthenticatedIdentity, ownerTelegramId: 'fixture-owner', ownerVkId: 'fixture-vk-owner',
    TERMS_VERSION: terms };
  const app = express();
  const serverSource = await source('server.js');
  vm.runInNewContext(
    between(serverSource, 'async function authRequired(', '\nfunction requireRole(')
      + between(serverSource, 'registerWalletRoutes(app, {', "\napp.get('/api/halloween/summary'"),
    { ...globals, ...config, app, registerWalletRoutes, getProfile: async () => ({
      id: row.id, role: row.role, qrShortCode: config.qrShortCode, termsAccepted: consent
    }) }
  );
  app.use((_req, res) => res.status(404).json({ error: 'fixture_not_found' }));
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
  const internal = http.createServer(app);
  await new Promise((resolve) => internal.listen(0, '127.0.0.1', resolve));
  const gatewaySource = await source('universal-server.js');
  const context = vm.createContext({ ...globals, internalPort: internal.address().port, childReady: true });
  try { vm.runInContext(
    between(gatewaySource, 'async function canonicalizeSessionToken(', '\nasync function ensurePersonalQr(')
      + between(gatewaySource, 'function sendJson(', '\nexport async function renderAppIndex(')
      + between(gatewaySource, 'function isConsentExempt(', '\nconst child =')
      + '\nthis.dispatch = async (req, res) => { const url = new URL(req.url, "http://localhost"); try {\n'
      + between(gatewaySource, "    if (url.pathname.startsWith('/api/') && !isConsentExempt", '\n  } catch (error) {\n    const status = Number(error.statusCode || 500);')
      + '\n} catch (error) { sendJson(res, error.statusCode || 500, { error: error.message }); } };', context
  ); } catch (error) {
    await new Promise((resolve) => internal.close(resolve));
    throw error;
  }
  const gateway = http.createServer((req, res) => context.dispatch(req, res));
  await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  const request = async (path, credential, throughGateway = true, method = 'GET') => {
    const server = throughGateway ? gateway : internal;
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: credential ? { authorization: `Bearer ${credential}` } : {}
    });
    return { status: response.status, body: await response.json() };
  };
  return { request, queries, consent: (value) => { consent = value; }, close: async () => {
    await Promise.all([gateway, internal].map((server) => new Promise((resolve) => server.close(resolve))));
  } };
}

test('Wallet routes preserve both provider availability flags and 503 responses', async () => {
  for (const apple of ['', 'https://wallet.invalid/apple']) {
    for (const google of ['', 'https://wallet.invalid/google']) {
      const app = await mount({ appleWalletIssuerUrl: apple, googleWalletIssuerUrl: google, qrShortCode: null });
      try {
        for (const platform of ['telegram', 'vk']) {
          const credential = token(platform);
          assert.deepEqual(await app.request('/api/wallet/config', credential), {
            status: 200, body: { appleAvailable: Boolean(apple), googleAvailable: Boolean(google), fallbackAvailable: true }
          });
          for (const [provider, issuer] of [['apple', apple], ['google', google]]) {
            const result = await app.request(`/api/wallet/${provider}`, credential);
            if (issuer) assert.deepEqual(result, { status: 200, body: { url: `${issuer}?user=1&token=` } });
            else assert.deepEqual(result, { status: 503, body: { error: provider === 'apple'
              ? 'Apple Wallet ещё не подключён владельцем.' : 'Google Wallet ещё не подключён владельцем.' } });
          }
        }
      } finally { await app.close(); }
    }
  }
});

test('Wallet links preserve existing query/fragment and use only the authenticated profile', async () => {
  const qr = 'PVK A&B/1';
  const app = await mount({ appleWalletIssuerUrl: 'https://wallet.invalid/apple?pass=keep&user=old&token=old#card',
    googleWalletIssuerUrl: 'https://wallet.invalid/google?pass=keep&user=old&token=old#card', qrShortCode: qr });
  try {
    for (const platform of ['telegram', 'vk']) {
      for (const provider of ['apple', 'google']) {
        const path = `/api/wallet/${provider}?user=999&token=forged`;
        const direct = await app.request(path, token(platform), false);
        assert.deepEqual(await app.request(path, token(platform)), direct);
        assert.equal(direct.status, 200);
        const url = new URL(direct.body.url);
        assert.equal(url.pathname, `/${provider}`);
        assert.equal(url.hash, '#card');
        assert.equal(url.searchParams.get('pass'), 'keep');
        assert.deepEqual(url.searchParams.getAll('user'), ['1']);
        assert.deepEqual(url.searchParams.getAll('token'), [qr]);
      }
    }
    assert.ok(app.queries.every(({ sql }) => /^SELECT\b/.test(sql.trim())), 'Wallet routes must not write to the database');
  } finally { await app.close(); }
});

test('Wallet routes keep signed-session denials and gateway consent enforcement', async () => {
  const app = await mount({ appleWalletIssuerUrl: 'https://wallet.invalid/apple', googleWalletIssuerUrl: '', qrShortCode: 'PVK-FIXTURE' });
  try {
    for (const path of ['/api/wallet/config', '/api/wallet/apple', '/api/wallet/google']) {
      for (const platform of ['telegram', 'vk']) {
        for (const credential of ['', 'forged', token(platform, { sv: 2 }), token(platform, { uid: '9' }), token(platform, { exp: Date.now() - 1000 })]) {
          assert.equal((await app.request(path, credential)).status, 401);
          assert.equal((await app.request(path, credential, false)).status, 401);
        }
        assert.equal((await app.request(path, token(platform, { pid: 'foreign' }))).status, 401);
        app.consent(false);
        assert.deepEqual(await app.request(path, token(platform)), {
          status: 428, body: { error: 'Сначала примите правила программы.' }
        });
        app.consent(true);
      }
      assert.equal((await app.request(path, token('telegram'), false, 'POST')).status, 404);
    }
  } finally { await app.close(); }
});

test('Wallet handlers preserve invalid issuer rejection rather than returning a link', async () => {
  const handlers = new Map();
  registerWalletRoutes({ get: (path, _auth, handler) => handlers.set(path, handler) }, {
    authRequired: () => {}, appleWalletIssuerUrl: 'invalid-fixture-url', googleWalletIssuerUrl: 'invalid-fixture-url'
  });
  for (const provider of ['apple', 'google']) {
    await assert.rejects(handlers.get(`/api/wallet/${provider}`)({ user: { id: '1' } }, {
      json: () => assert.fail('An invalid issuer must not produce a link')
    }), { code: 'ERR_INVALID_URL' });
  }
});
