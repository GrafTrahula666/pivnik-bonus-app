import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('VK native hosting config targets app 54694987 and the static build directory', async () => {
  const config = JSON.parse(await read('vk-hosting-config.json'));
  assert.equal(config.app_id, 54694987);
  assert.equal(config.static_path, 'vk-hosting-build');
  assert.deepEqual(config.endpoints, {
    mobile: 'index.html',
    mvk: 'index.html',
    web: 'index.html'
  });
});

test('VK hosting builder routes API through a separate HTTPS gateway and rejects browser Railway/Vercel', async () => {
  const source = await read('scripts/build-vk-hosting.mjs');
  assert.match(source, /PIVNIK_VK_API_BASE/);
  assert.match(source, /__PIVNIK_VK_API_BASE__/);
  assert.match(source, /resolveGatewayInput/);
  assert.match(source, /VK Hosting gateway must not use vercel\.app/);
  assert.match(source, /VK Hosting gateway must not expose Railway directly/);
  assert.match(source, /vendor\/vk-bridge\.js/);
  assert.match(source, /VK Hosting build still contains Telegram WebApp runtime/);
});

test('Selectel gateway accepts VK dev and production Hosting origins but exposes only API routes', async () => {
  const source = await read('vk-api-gateway/server.mjs');
  assert.match(source, /Only \/api\/\* is exposed/);
  assert.match(source, /VK Hosting Origin is required/);
  assert.match(source, /host\.endsWith\('\.pages\.vk-apps\.com'\)/);
  assert.match(source, /host\.endsWith\('\.pages\.vk-apps\.ru'\)/);
  assert.match(source, /host\.endsWith\('\.pages-ac\.vk-apps\.com'\)/);
  assert.match(source, /host\.endsWith\('\.pages-ac\.vk-apps\.ru'\)/);
  assert.match(source, /access-control-allow-origin/);
  assert.match(source, /access-control-allow-methods/);
  assert.match(source, /access-control-allow-headers/);
  assert.match(source, /headers\.set\('origin', RAILWAY_ORIGIN\.origin\)/);
  assert.match(source, /x-pivnik-gateway/);
  assert.match(source, /x-pivnik-platform/);
  assert.match(source, /\/readyz/);
  assert.doesNotMatch(source, /FORWARDED_REQUEST_HEADERS[\s\S]{0,500}'sec-fetch-site'/);
});

test('Selectel bootstrap uses nip.io and defaults recovery to current main', async () => {
  const [bootstrap, cloudInit] = await Promise.all([
    read('vk-api-gateway/bootstrap-nip.sh'),
    read('vk-api-gateway/selectel-cloud-init.yaml')
  ]);
  assert.match(bootstrap, /api\.ipify\.org/);
  assert.match(bootstrap, /\$\{PUBLIC_IP\}\.nip\.io/);
  assert.match(bootstrap, /docker compose up -d --build/);
  assert.match(bootstrap, /\/readyz/);
  assert.match(bootstrap, /PIVNIK_REPO_REF:-main/);
  assert.match(cloudInit, /#cloud-config/);
  assert.match(cloudInit, /PIVNIK_REPO_REF:-main/);
  assert.match(cloudInit, /bootstrap-nip\.sh/);
  assert.doesNotMatch(bootstrap + cloudInit, /fix\/vk-native-hosting-main-parity-20260912/);
});

test('pages-ac hotfix is rollback-safe and validates the current production origin', async () => {
  const source = await read('vk-api-gateway/apply-pages-ac-hotfix.sh');
  assert.match(source, /PIVNIK_REPO_REF:-main/);
  assert.doesNotMatch(source, /fix\/vk-native-hosting-main-parity-20260912/);
  assert.match(source, /server\.mjs\.backup-/);
  assert.match(source, /pages-ac\.vk-apps\.ru/);
  assert.match(source, /docker compose up -d --build --force-recreate gateway/);
  assert.match(source, /Expected CORS 204/);
  assert.match(source, /Hotfix verification failed; restoring/);
  assert.match(source, /PIVNIK VK GATEWAY HOTFIX OK/);
});
