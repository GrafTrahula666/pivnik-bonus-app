import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('VK native hosting config targets app 54694987 and a static build directory', async () => {
  const config = JSON.parse(await read('vk-hosting-config.json'));
  assert.equal(config.app_id, 54694987);
  assert.equal(config.static_path, 'vk-hosting-build');
  assert.deepEqual(config.endpoints, {
    mobile: 'index.html',
    mvk: 'index.html',
    web: 'index.html'
  });
});

test('VK hosting builder injects a separate API base and refuses Railway/Vercel browser endpoints', async () => {
  const source = await read('scripts/build-vk-hosting.mjs');
  assert.match(source, /__PIVNIK_VK_API_BASE__/);
  assert.match(source, /resolveGatewayInput/);
  assert.match(source, /originalFetch\\\(resolveGatewayInput\\\(input\\\)/);
  assert.match(source, /VK Hosting gateway must not use vercel\.app/);
  assert.match(source, /VK Hosting gateway must not expose Railway directly/);
  assert.match(source, /telegram-wheel:start/);
  assert.match(source, /vendor\/vk-bridge\.js/);
});

test('VK gateway exposes only API routes and converts the second hop to trusted server-to-server origin', async () => {
  const source = await read('vk-api-gateway/server.mjs');
  assert.match(source, /Only \/api\/\* is exposed/);
  assert.match(source, /\.pages\.vk-apps\.com/);
  assert.match(source, /\.pages\.vk-apps\.ru/);
  assert.match(source, /headers\.set\('origin', RAILWAY_ORIGIN\.origin\)/);
  assert.match(source, /x-pivnik-gateway/);
  assert.doesNotMatch(source, /FORWARDED_REQUEST_HEADERS[\s\S]{0,500}'sec-fetch-site'/);
  assert.match(source, /x-pivnik-platform/);
  assert.match(source, /\/readyz/);
});

test('root package checks both the static builder and gateway syntax', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.match(pkg.scripts.check, /scripts\/build-vk-hosting\.mjs/);
  assert.match(pkg.scripts.check, /vk-api-gateway\/server\.mjs/);
  assert.match(pkg.scripts['build:vk-hosting'], /build-vk-hosting\.mjs/);
  assert.match(pkg.scripts['deploy:vk-hosting'], /@vkontakte\/vk-miniapps-deploy@1\.0\.2/);
});
