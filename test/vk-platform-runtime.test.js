import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

test('VK auth reaches the server when Bridge acknowledgements never settle', async () => {
  const source = await readFile(new URL('../vk-platform.js', import.meta.url), 'utf8');
  const originalFetchCalls = [];
  const never = new Promise(() => {});
  const location = {
    href: 'https://pivnik.example/vk?vk_app_id=54694987&vk_user_id=123&sign=test',
    search: '?vk_app_id=54694987&vk_user_id=123&sign=test'
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
        headers: { get: () => '' }
      };
    },
    addEventListener() {},
    dispatchEvent() {},
    setTimeout(callback) {
      queueMicrotask(callback);
      return 1;
    },
    clearTimeout() {}
  };
  const document = {
    documentElement: { classList: { add() {} } },
    addEventListener() {}
  };
  const storage = new Map();
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
    queueMicrotask,
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
});
