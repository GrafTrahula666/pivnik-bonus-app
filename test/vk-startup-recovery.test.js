import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = process.env.PIVNIK_STARTUP_SOURCE_ROOT || new URL('../', import.meta.url).pathname;
const source = await fs.readFile(path.join(root, 'app.js'), 'utf8');
const bootSource = source.slice(source.indexOf('async function boot()'), source.indexOf('async function acceptTerms()'));

function bootHarness({ api, token = 'valid-session', vk = true } = {}) {
  const storage = new Map([['pivnik_session', token]]);
  const events = [];
  const state = { token, profile: null };
  const context = vm.createContext({
    state, IS_VK: vk, PLATFORM_NAME: vk ? 'VK' : 'Telegram',
    window: {}, api, console: { warn() {}, error() {} },
    safeStorage: { remove: (key) => storage.delete(key) },
    $: () => ({ textContent: '', disabled: false }),
    clearBootError() {}, refreshTelegramBridge() {}, renderCoreProfile() {},
    closeModal() {}, schedulePostBootHydration() {},
    applyProfilePayload(data) { state.profile = data.profile; },
    authenticate: async () => { events.push('auth'); throw Object.assign(new Error('expired launch'), { status: 401 }); },
    finishBoot: async () => { events.push('complete'); },
    showBootActions: (message) => events.push(message)
  });
  vm.runInContext('let bootInFlight = null; let bootCompleted = false;\n' + bootSource, context);
  return { context, storage, state, events, boot: () => vm.runInContext('boot()', context) };
}

for (const failure of [503, 502, 429, 'TIMEOUT', 'NETWORK']) {
  test(`VK preserves a valid session after bootstrap ${failure}; retry recovers without expired launch auth`, async () => {
    let requests = 0;
    const h = bootHarness({ api: async () => {
      if (++requests === 1) throw Object.assign(new Error('temporary failure'),
        typeof failure === 'number' ? { status: failure } : { code: failure });
      return { profile: { id: 'existing-user' } };
    } });
    await h.boot();
    assert.equal(h.state.token, 'valid-session');
    assert.equal(h.storage.get('pivnik_session'), 'valid-session');
    assert.equal(h.events.includes('auth'), false);
    await h.boot();
    assert.equal(h.state.profile.id, 'existing-user');
    assert.equal(h.events.filter((event) => event === 'complete').length, 1);
  });
}

test('VK retries only a server-rejected session through signed auth', async () => {
  const h = bootHarness({ api: async () => { throw Object.assign(new Error('invalid session'), { status: 401 }); } });
  await h.boot();
  assert.equal(h.state.token, '');
  assert.equal(h.storage.has('pivnik_session'), false);
  assert.equal(h.events.filter((event) => event === 'auth').length, 1);
});

test('Concurrent VK boot calls share one profile request and one completion', async () => {
  let requests = 0;
  let release;
  const response = new Promise((resolve) => { release = resolve; });
  const h = bootHarness({ api: () => { requests++; return response; } });
  const first = h.boot(); const second = h.boot();
  const callsBeforeResponse = requests;
  release({ profile: { id: 'existing-user' } });
  await Promise.all([first, second]);
  assert.equal(callsBeforeResponse, 1);
  assert.equal(h.events.filter((event) => event === 'complete').length, 1);
});

test('Telegram returning-session boot still completes without calling social auth', async () => {
  const h = bootHarness({ vk: false, api: async () => ({ profile: { id: 'tg-user' } }) });
  await h.boot();
  assert.equal(h.state.profile.id, 'tg-user');
  assert.deepEqual(h.events, ['complete']);
});

async function vkHarness({ search = '', hash = '', send, fetch: nativeFetch,
  storage = new Map([['pivnik_tg_session', 'telegram-session']]) } = {}) {
  const calls = [];
  const timers = new Map();
  let timerId = 0;
  const location = { search, hash, href: `https://pivnik.example/vk${search}${hash}` };
  const window = {
    location, vkBridge: send ? { send } : undefined,
    fetch: async (input, init) => { calls.push({ input, init }); return nativeFetch
      ? nativeFetch(input, init) : new Response('{}', { status: 200 }); },
    addEventListener() {}, dispatchEvent() {},
    setTimeout(callback, ms) { const id = ++timerId; timers.set(id, { callback, ms }); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  const context = vm.createContext({
    window, location, URL, URLSearchParams, Headers, Response, Request,
    AbortController, CustomEvent, DOMException, Promise,
    console: { warn() {}, info() {} },
    document: { documentElement: { classList: { add() {} } }, addEventListener() {} },
    MutationObserver: class {},
    localStorage: { getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) }
  });
  vm.runInContext(await fs.readFile(path.join(root, 'vk-platform.js'), 'utf8'), context);
  return { window, calls, storage, timers,
    auth: (init = {}) => window.fetch('/api/auth', { method: 'POST', body: '{}', ...init }) };
}

test('A failed Bridge launch-params request is retried on the next boot', async () => {
  let launchCalls = 0;
  const h = await vkHarness({ send(method) {
    if (method === 'VKWebAppGetLaunchParams') {
      if (++launchCalls === 1) return Promise.reject(new Error('bridge temporarily unavailable'));
      return Promise.resolve({ vk_app_id: 54694987, vk_user_id: 888, vk_ts: 123456, sign: 'fresh-test-sign' });
    }
    return new Promise(() => {});
  } });
  await h.auth(); await h.auth();
  assert.equal(launchCalls, 2);
  assert.match(JSON.parse(h.calls.at(-1).init.body).launchParams, /vk_user_id=888/);
});

test('Bridge-only identity selects its own storage namespace after successful auth', async () => {
  const h = await vkHarness({ send(method) {
    if (method === 'VKWebAppGetLaunchParams') return Promise.resolve({ vk_app_id: 54694987, vk_user_id: 888, vk_ts: 123456, sign: 'test-sign' });
    return new Promise(() => {});
  } });
  await h.auth();
  assert.equal(h.window.__PIVNIK_STORAGE_PREFIX__, 'pivnik_vk_888_');
  assert.equal(h.window.__PIVNIK_VK_USER_ID__, '888');
  assert.equal(h.storage.get('pivnik_tg_session'), 'telegram-session');
});

const signed = (user = 888, sign = 'test-sign') =>
  `?vk_app_id=54694987&vk_user_id=${user}&vk_ts=123456&sign=${sign}`;

test('VK authenticates from URL when Bridge is unavailable', async () => {
  const h = await vkHarness({ search: signed() });
  assert.equal((await h.auth()).status, 200);
  assert.equal(JSON.parse(h.calls[0].init.body).user, null);
  assert.match(JSON.parse(h.calls[0].init.body).launchParams, /vk_user_id=888/);
});

test('Delayed Bridge launch params and delayed auth preserve ordering until a response arrives', async () => {
  let releaseParams; let releaseAuth;
  const params = new Promise((resolve) => { releaseParams = resolve; });
  const response = new Promise((resolve) => { releaseAuth = resolve; });
  const h = await vkHarness({
    send: (method) => method === 'VKWebAppGetLaunchParams' ? params : new Promise(() => {}),
    fetch: () => response
  });
  let settled = false;
  const auth = h.auth().then(() => { settled = true; });
  await new Promise(setImmediate);
  assert.equal(h.calls.length, 0);
  releaseParams(Object.fromEntries(new URLSearchParams(signed().slice(1))));
  await new Promise(setImmediate);
  assert.equal(h.calls.length, 1);
  assert.equal(settled, false);
  releaseAuth(new Response('{}', { status: 200 }));
  await auth;
  assert.equal(h.window.__PIVNIK_STORAGE_PREFIX__, 'pivnik_vk_888_');
});

test('A hanging Bridge launch request times out and the next auth can ask again', async () => {
  let requests = 0;
  const h = await vkHarness({ send(method) {
    if (method === 'VKWebAppGetLaunchParams' && ++requests > 1) {
      return Promise.resolve(Object.fromEntries(new URLSearchParams(signed().slice(1))));
    }
    return new Promise(() => {});
  }, fetch: () => new Response('{}', { status: 401 }) });
  const first = h.auth();
  for (const [id, timer] of h.timers) {
    if (timer.ms === 2200) { h.timers.delete(id); timer.callback(); }
  }
  await first;
  assert.equal(requests, 2);
  assert.match(JSON.parse(h.calls.at(-1).init.body).launchParams, /vk_user_id=888/);
});

test('401 refreshes launch params once, switches identity, and preserves both accounts and Telegram storage', async () => {
  let requests = 0;
  const storage = new Map([
    ['pivnik_vk_111_session', 'old-account-session'],
    ['pivnik_vk_888_session', 'other-account-session'],
    ['pivnik_tg_session', 'telegram-session']
  ]);
  const h = await vkHarness({ search: signed(111, 'old'), storage,
    send(method) {
      if (method === 'VKWebAppGetLaunchParams') return Promise.resolve(Object.fromEntries(new URLSearchParams(signed(888, 'fresh').slice(1))));
      if (method === 'VKWebAppGetUserInfo') return Promise.resolve({ id: 111, first_name: 'Fixture' });
      return Promise.resolve({});
    },
    fetch: () => new Response('{}', { status: ++requests === 1 ? 401 : 200 })
  });
  await new Promise(setImmediate);
  await h.auth();
  assert.equal(requests, 2);
  const refreshed = JSON.parse(h.calls[1].init.body);
  assert.match(refreshed.launchParams, /vk_user_id=888/);
  assert.equal(refreshed.user, null, 'a profile from the old Bridge identity must not accompany the new signature');
  assert.equal(h.window.__PIVNIK_STORAGE_PREFIX__, 'pivnik_vk_888_');
  assert.deepEqual([...storage.values()], ['old-account-session', 'other-account-session', 'telegram-session']);
});

test('401 with unchanged launch params does not create an auth retry loop', async () => {
  let refreshes = 0;
  const h = await vkHarness({ search: signed(), send(method) {
    if (method === 'VKWebAppGetLaunchParams') {
      refreshes++;
      return Promise.resolve(Object.fromEntries(new URLSearchParams(signed().slice(1))));
    }
    return new Promise(() => {});
  }, fetch: () => new Response('{}', { status: 401 }) });
  assert.equal((await h.auth()).status, 401);
  assert.equal(h.calls.length, 1);
  assert.equal(refreshes, 1);
});

test('Missing URL identity discards only unknown VK sessions, leaving scoped sessions intact', async () => {
  const storage = new Map([
    ['pivnik_vk_unknown_session', 'stale'], ['pivnik_vk_unknown_staff_session', 'stale-staff'],
    ['pivnik_vk_888_session', 'valid'], ['pivnik_tg_session', 'telegram']
  ]);
  await vkHarness({ storage });
  assert.deepEqual([...storage.keys()], ['pivnik_vk_888_session', 'pivnik_tg_session']);
});

test('Ten returning-session boot attempts finish with one request per attempt', async () => {
  let requests = 0;
  const h = bootHarness({ api: async () => { requests++; return { profile: { id: 'existing-user' } }; } });
  for (let i = 0; i < 10; i++) await h.boot();
  assert.equal(requests, 10);
  assert.equal(h.events.filter((event) => event === 'complete').length, 10);
  assert.equal(h.storage.get('pivnik_session'), 'valid-session');
});
