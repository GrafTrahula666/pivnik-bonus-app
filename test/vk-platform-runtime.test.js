import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

test('VK auth reaches the server when Bridge acknowledgements never settle', async () => {
  const source = await readFile(new URL('../vk-platform.js', import.meta.url), 'utf8');
  const originalFetchCalls = [];
  const never = new Promise(() => {});
  const location = {
    href: 'https://pivnik.example/vk?vk_app_id=54694987&vk_user_id=123&vk_ts=123456&sign=test',
    search: '?vk_app_id=54694987&vk_user_id=123&vk_ts=123456&sign=test',
    hash: ''
  };
  const window = {
    location,
    vkBridge: {
      send(method) {
        assert.ok(['VKWebAppInit', 'VKWebAppGetUserInfo'].includes(method));
        return never;
      }
    },
    fetch: async (input, init) => {
      originalFetchCalls.push({ input, init });
      return {
        status: 200,
        headers: { get: () => '' }
      };
    },
    addEventListener() {},
    dispatchEvent() {},
    setTimeout() {
      return 1;
    },
    clearTimeout() {}
  };
  const document = {
    documentElement: { classList: { add() {} } },
    addEventListener() {}
  };
  const storage = new Map();
  storage.set('pivnik_vk_123_session', 'persisted-session');
  const localStorage = {
    getItem: (key) => storage.get(key) || null,
    removeItem: (key) => storage.delete(key),
    setItem: (key, value) => storage.set(key, String(value))
  };

  vm.runInNewContext(source, {
    AbortController,
    CustomEvent,
    DOMException,
    Headers,
    MutationObserver: class {},
    Promise,
    URL,
    URLSearchParams,
    console: { warn() {} },
    document,
    localStorage,
    location,
    window
  });

  await window.fetch('/api/auth', {
    method: 'POST',
    body: '{}',
    headers: { 'content-type': 'application/json' }
  });

  assert.equal(originalFetchCalls.length, 1);
  const payload = JSON.parse(originalFetchCalls[0].init.body);
  assert.equal(payload.platform, 'vk');
  assert.equal(payload.user, null);
  assert.match(payload.launchParams, /vk_user_id=123/);
  assert.equal(storage.get('pivnik_vk_123_session'), 'persisted-session');
});

test('VK auth accepts signed launch params from the URL fragment', async () => {
  const source = await readFile(new URL('../vk-platform.js', import.meta.url), 'utf8');
  const originalFetchCalls = [];
  const never = new Promise(() => {});
  const location = {
    href: 'https://pivnik.example/vk#/start?vk_app_id=54694987&vk_user_id=777&vk_ts=123456&sign=hash-sign',
    search: '',
    hash: '#/start?vk_app_id=54694987&vk_user_id=777&vk_ts=123456&sign=hash-sign'
  };
  const window = {
    location,
    vkBridge: { send: () => never },
    fetch: async (input, init) => {
      originalFetchCalls.push({ input, init });
      return { status: 200, headers: { get: () => '' } };
    },
    addEventListener() {},
    dispatchEvent() {},
    setTimeout() { return 1; },
    clearTimeout() {}
  };
  const document = {
    documentElement: { classList: { add() {} } },
    addEventListener() {}
  };
  const localStorage = {
    getItem: () => null,
    removeItem() {},
    setItem() {}
  };

  vm.runInNewContext(source, {
    AbortController,
    CustomEvent,
    DOMException,
    Headers,
    MutationObserver: class {},
    Promise,
    URL,
    URLSearchParams,
    console: { warn() {} },
    document,
    localStorage,
    location,
    window
  });

  await window.fetch('/api/auth', {
    method: 'POST',
    body: '{}',
    headers: { 'content-type': 'application/json' }
  });

  const payload = JSON.parse(originalFetchCalls[0].init.body);
  assert.match(payload.launchParams, /vk_user_id=777/);
  assert.match(payload.launchParams, /sign=hash-sign/);
});

test('VK auth falls back to VKWebAppGetLaunchParams when the URL has no signature', async () => {
  const source = await readFile(new URL('../vk-platform.js', import.meta.url), 'utf8');
  const originalFetchCalls = [];
  const never = new Promise(() => {});
  const location = {
    href: 'https://pivnik.example/vk',
    search: '',
    hash: ''
  };
  const window = {
    location,
    vkBridge: {
      send(method) {
        if (method === 'VKWebAppGetLaunchParams') {
          return Promise.resolve({
            vk_app_id: 54694987,
            vk_user_id: 888,
            vk_ts: 123456,
            vk_platform: 'mobile_iphone',
            vk_access_token_settings: '',
            sign: 'bridge-sign'
          });
        }
        return never;
      }
    },
    fetch: async (input, init) => {
      originalFetchCalls.push({ input, init });
      return { status: 200, headers: { get: () => '' } };
    },
    addEventListener() {},
    dispatchEvent() {},
    setTimeout() { return 1; },
    clearTimeout() {}
  };
  const document = {
    documentElement: { classList: { add() {} } },
    addEventListener() {}
  };
  const localStorage = {
    getItem: () => null,
    removeItem() {},
    setItem() {}
  };

  vm.runInNewContext(source, {
    AbortController,
    CustomEvent,
    DOMException,
    Headers,
    MutationObserver: class {},
    Promise,
    URL,
    URLSearchParams,
    console: { warn() {} },
    document,
    localStorage,
    location,
    window
  });

  await window.fetch('/api/auth', {
    method: 'POST',
    body: '{}',
    headers: { 'content-type': 'application/json' }
  });

  const payload = JSON.parse(originalFetchCalls[0].init.body);
  assert.match(payload.launchParams, /vk_user_id=888/);
  assert.match(payload.launchParams, /vk_platform=mobile_iphone/);
  assert.match(payload.launchParams, /vk_access_token_settings=/);
  assert.match(payload.launchParams, /sign=bridge-sign/);
});

test('Client API timeout covers both fetch and response body', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const helpers = source.match(
    /function timeoutError\(\)[\s\S]*?async function fetchWithTimeout\([\s\S]*?\n}\n\n(?=async function api)/
  )?.[0];
  assert.ok(helpers, 'fetchWithTimeout helpers must remain extractable for runtime verification');

  class IgnoredAbortController {
    constructor() {
      this.signal = {};
      this.aborted = false;
    }

    abort() {
      this.aborted = true;
    }
  }

  const never = () => new Promise(() => {});
  const cases = [
    () => never(),
    async () => ({ json: () => never() })
  ];

  for (const fetchImplementation of cases) {
    let controller;
    class TrackedAbortController extends IgnoredAbortController {
      constructor() {
        super();
        controller = this;
      }
    }
    const context = {
      AbortController: TrackedAbortController,
      Error,
      Promise,
      clearTimeout() {},
      fetch: fetchImplementation,
      setTimeout(callback) {
        queueMicrotask(callback);
        return 1;
      }
    };
    vm.runInNewContext(
      `${helpers}\nglobalThis.testFetchWithTimeout = fetchWithTimeout;`,
      context
    );

    await assert.rejects(
      context.testFetchWithTimeout('/api/auth', { method: 'POST' }, 7000),
      (error) => error?.code === 'TIMEOUT'
    );
    assert.equal(controller.aborted, true);
  }
});
