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

test('VK hosting builder injects a separate API base and keeps Telegram client parity', async () => {
  const source = await read('scripts/build-vk-hosting.mjs');
  assert.match(source, /__PIVNIK_VK_API_BASE__/);
  assert.match(source, /resolveGatewayInput/);
  assert.match(source, /originalFetch\(resolveGatewayInput\(input\)/);
  assert.match(source, /VK Hosting gateway must not use vercel\.app/);
  assert.match(source, /VK Hosting gateway must not expose Railway directly/);
  assert.match(source, /telegram-wheel-legacy:start/);
  assert.doesNotMatch(source, /\.replace\(\/<!-- telegram-wheel:start -->/);
  assert.match(source, /VK_TELEGRAM_PARITY_CSS/);
  assert.match(source, /luxury-vip-space\.webp/);
  assert.match(source, /vk-telegram-parity\.css/);
  assert.match(source, /html\.platform-vk \.home-feature-grid/);
  assert.match(source, /html\.platform-vk \.client-tip/);
  assert.match(source, /assertVkClientParity/);
  assert.match(source, /assertVkWheelRuntime/);
  assert.match(source, /openWheelButton/);
  assert.match(source, /wheelSpinButton/);
  assert.match(source, /openProfileShop/);
  assert.match(source, /function renderWheelArtwork/);
  assert.match(source, /function spinWheel/);
  assert.match(source, /loadSecondaryData/);
  assert.match(source, /VK wheel runtime is still platform-disabled/);
  assert.match(source, /vendor\/vk-bridge\.js/);
});

test('VK production materialization uses the shared deep-space background without changing interaction logic', async () => {
  const source = await read('scripts/apply-vk-production-hotfix-20260831.mjs');
  assert.match(source, /assets\/backgrounds\/luxury-vip-space\.webp/);
  assert.match(source, /luxury-vip-space\.webp\?v=17\.1-vk/);
  assert.match(source, /filter:brightness\(1\.72\) saturate\(1\.22\) contrast\(1\.06\)/);
  assert.match(source, /html\.platform-vk #appShell>main/);
  assert.match(source, /html\.platform-vk \.app-shell::before/);
  assert.doesNotMatch(source, /radial-gradient\(ellipse at 79% 22%/);
});

test('VK gateway exposes only API routes and converts the second hop to trusted server-to-server origin', async () => {
  const source = await read('vk-api-gateway/server.mjs');
  assert.match(source, /Only \/api\/\* is exposed/);
  assert.match(source, /if \(!value\) return false/);
  assert.match(source, /VK Hosting Origin is required/);
  assert.match(source, /\.pages\.vk-apps\.com/);
  assert.match(source, /\.pages\.vk-apps\.ru/);
  assert.match(source, /headers\.set\('origin', RAILWAY_ORIGIN\.origin\)/);
  assert.match(source, /x-pivnik-gateway/);
  assert.doesNotMatch(source, /FORWARDED_REQUEST_HEADERS[\s\S]{0,500}'sec-fetch-site'/);
  assert.match(source, /x-pivnik-platform/);
  assert.match(source, /\/readyz/);
});

test('Selectel bootstrap derives a nip.io HTTPS gateway from public IPv4', async () => {
  const [bootstrap, cloudInit] = await Promise.all([
    read('vk-api-gateway/bootstrap-nip.sh'),
    read('vk-api-gateway/selectel-cloud-init.yaml')
  ]);
  assert.match(bootstrap, /api\.ipify\.org/);
  assert.match(bootstrap, /\$\{PUBLIC_IP\}\.nip\.io/);
  assert.match(bootstrap, /docker compose up -d --build/);
  assert.match(bootstrap, /\/readyz/);
  assert.match(cloudInit, /#cloud-config/);
  assert.match(cloudInit, /fix\/vk-native-hosting-gateway/);
  assert.match(cloudInit, /bootstrap-nip\.sh/);
});

test('root package checks both the static builder and gateway syntax', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.match(pkg.scripts.check, /scripts\/build-vk-hosting\.mjs/);
  assert.match(pkg.scripts.check, /vk-api-gateway\/server\.mjs/);
  assert.match(pkg.scripts['build:vk-hosting'], /build-vk-hosting\.mjs/);
  assert.match(pkg.scripts['deploy:vk-hosting'], /@vkontakte\/vk-miniapps-deploy@1\.0\.2/);
});