import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Existing gateway contract: vk-api-gateway/server.mjs at 12a1fa0b.
// Node fetch does not enforce CORS; reject unsupported headers explicitly here.
const gatewayHeaders = new Set([
  'authorization', 'content-type', 'x-pivnik-version', 'x-pivnik-platform',
  'x-pivnik-explicit-consent', 'x-staff-session'
]);
const source = await readFile(new URL('../vk-platform.js', import.meta.url), 'utf8');
const signed = '?vk_app_id=54694987&vk_user_id=888&vk_ts=123456&sign=test-sign';

function harness({ nativeHosting = false, enforceGateway = false } = {}) {
  const calls = [];
  const events = [];
  const timers = new Map();
  let nextTimer = 0;
  let releaseProfile;
  const bridgeProfile = new Promise((resolve) => { releaseProfile = resolve; });
  const location = { search: signed, hash: '', href: `https://pivnik.example/index.html${signed}` };
  const window = {
    location,
    ...(nativeHosting ? { __PIVNIK_VK_API_BASE__: 'https://vk-gateway.invalid' } : {}),
    vkBridge: { send: (method) => method === 'VKWebAppGetUserInfo' ? bridgeProfile : Promise.resolve({}) },
    fetch: async (input, init = {}) => {
      const headers = new Headers(init.headers);
      calls.push({ input, init, headers });
      if (enforceGateway) {
        for (const name of headers.keys()) {
          if (!gatewayHeaders.has(name)) throw new TypeError(`CORS header rejected: ${name}`);
        }
        if (init.method === 'POST' && headers.get('x-pivnik-platform') !== 'vk') {
          return Response.json({ error: 'VK platform header is required.' }, { status: 403 });
        }
      }
      return Response.json({ token: 'test-session', profile: { id: '888', role: 'admin', termsAccepted: true } });
    },
    addEventListener() {},
    dispatchEvent: (event) => events.push(event),
    setTimeout(callback, ms) { const id = ++nextTimer; timers.set(id, { callback, ms }); return id; },
    clearTimeout: (id) => timers.delete(id)
  };
  vm.runInNewContext(source, {
    window, location, URL, URLSearchParams, Headers, Response, Request,
    AbortController, CustomEvent, DOMException, Promise,
    console: { warn() {}, info() {} },
    document: { documentElement: { classList: { add() {} } }, addEventListener() {} },
    localStorage: { removeItem() {} }, MutationObserver: class {}
  });
  return {
    window, calls, events, timers,
    releaseProfile: () => releaseProfile({ id: 888, first_name: 'VK', last_name: 'Fixture' }),
    auth: () => window.fetch('/api/auth', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-pivnik-platform': 'vk' }, body: '{}'
    })
  };
}

test('native hosting auth and session reads fit the deployed gateway CORS allowlist', async () => {
  const h = harness({ nativeHosting: true, enforceGateway: true });
  assert.equal((await h.auth()).status, 200);
  for (const path of ['/api/bootstrap', '/api/me']) {
    assert.equal((await h.window.fetch(path, {
      headers: { authorization: 'Bearer test-session', 'x-pivnik-platform': 'vk' }
    })).status, 200);
  }
  assert.equal(h.calls.length, 3);
  assert.ok(h.calls.every(({ headers }) => !headers.has('x-pivnik-boot-id')));
});

test('same-origin VK retains request correlation', async () => {
  const h = harness();
  await h.auth();
  await h.window.fetch('/api/bootstrap');
  await h.window.fetch('/api/me');
  assert.ok(h.calls.every(({ headers }) => headers.get('x-pivnik-boot-id') === h.window.__PIVNIK_VK_DIAGNOSTICS__.id));
});

test('delayed VK profile hydration includes the gateway platform header', async () => {
  const h = harness();
  await h.auth();
  h.releaseProfile();
  await new Promise(setImmediate);
  const hydration = h.calls.find(({ init }) => JSON.parse(init.body || '{}').user?.id === 888);
  assert.ok(hydration, 'Bridge profile must be sent after signed auth finishes');
  assert.equal(hydration.headers.get('x-pivnik-platform'), 'vk');
  assert.equal(h.events.find((event) => event.type === 'pivnik:vk-profile-hydrated')?.detail.profile.role, 'admin');
});

test('manual VK avatar refresh passes the gateway write guard', async () => {
  const h = harness({ nativeHosting: true, enforceGateway: true });
  h.releaseProfile();
  const hydration = await h.window.__PIVNIK_VK_REFRESH_PROFILE__();
  assert.equal(hydration.profile.role, 'admin');
  assert.equal(h.calls.at(-1).headers.get('x-pivnik-platform'), 'vk');
});

test('native startup diagnostics retain boot correlation in the body and pass the gateway write guard', async () => {
  const h = harness({ nativeHosting: true, enforceGateway: true });
  const timer = [...h.timers.values()].find(({ ms }) => ms === 1000);
  assert.ok(timer);
  timer.callback();
  await new Promise(setImmediate);
  const diagnostic = h.calls.find(({ input }) => input === '/api/diagnostics/vk-startup');
  assert.ok(diagnostic);
  assert.equal(diagnostic.headers.get('x-pivnik-platform'), 'vk');
  assert.equal(JSON.parse(diagnostic.init.body).bootId, h.window.__PIVNIK_VK_DIAGNOSTICS__.id);
});
