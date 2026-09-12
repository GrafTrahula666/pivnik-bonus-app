import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('VK hosting config targets app 54694987 and static build output', async () => {
  const config = JSON.parse(await read('vk-hosting-config.json'));
  assert.equal(config.app_id, 54694987);
  assert.equal(config.static_path, 'vk-hosting-build');
  assert.deepEqual(config.endpoints, {
    mobile: 'index.html',
    mvk: 'index.html',
    web: 'index.html'
  });
  assert.equal(config.debug, false);
});

test('VK hosting builder is transport-only and preserves current main UI', async () => {
  const source = await read('scripts/build-vk-hosting.mjs');
  assert.match(source, /__PIVNIK_VK_API_BASE__/);
  assert.match(source, /resolveGatewayInput/);
  assert.match(source, /originalFetch\(resolveGatewayInput\(input\)/);
  assert.match(source, /VK Hosting gateway must not use vercel\.app/);
  assert.match(source, /VK Hosting gateway must not expose Railway directly/);
  assert.match(source, /telegram-web-app/);
  assert.match(source, /vendor\/vk-bridge\.js/);
  assert.match(source, /vk-platform\.js/);
  assert.doesNotMatch(source, /VK_TELEGRAM_PARITY_CSS/);
  assert.doesNotMatch(source, /home-feature-grid/);
  assert.doesNotMatch(source, /filter:brightness/);
});

test('current VK runtime still has exactly the fetch boundary required by static gateway routing', async () => {
  const runtime = await read('vk-platform.js');
  assert.match(runtime, /const originalFetch = window\.fetch\.bind\(window\)/);
  const directCalls = runtime.match(/originalFetch\(input/g) || [];
  assert.equal(directCalls.length, 2);
  assert.match(runtime, /VKWebAppInit/);
  assert.match(runtime, /VKWebAppGetLaunchParams/);
  assert.match(runtime, /VKWebAppGetUserInfo/);
});
