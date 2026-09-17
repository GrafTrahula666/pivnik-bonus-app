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

test('VK hosting builder resets failed Bridge launch refreshes and single-flights concurrent auth', async () => {
  const source = await read('scripts/build-vk-hosting.mjs');
  assert.match(source, /async function getBridgeLaunchParams\(\)/);
  assert.match(source, /if \(!resolvedLaunchParams\) bridgeLaunchParamsPromise = null/);
  assert.match(source, /let authInFlight = null/);
  assert.match(source, /if \(!authInFlight\)/);
  assert.match(source, /return authInFlight\.then\(\(response\) => response\.clone\(\)\)/);
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

test('VK auth requires signed launch params and can refresh them once after 401', async () => {
  const runtime = await read('vk-platform.js');
  assert.match(runtime, /const REQUIRED_LAUNCH_PARAMS = \['vk_app_id', 'vk_user_id', 'vk_ts', 'sign'\]/);
  assert.match(runtime, /REQUIRED_LAUNCH_PARAMS\.every\(\(key\) => Boolean\(params\.get\(key\)\)\)/);
  assert.match(runtime, /async function resolveLaunchParams\(preferBridge = false\)/);
  assert.match(runtime, /if \(!preferBridge && hasSignedLaunchParams\(launchParams\)\) return launchParams/);
  assert.match(runtime, /if \(pathname === '\/api\/auth'\)/);
  assert.match(runtime, /platform: 'vk'/);
  assert.match(runtime, /launchParams: signedLaunchParams/);
  assert.match(runtime, /if \(response\.status === 401\)/);
  assert.match(runtime, /resolveLaunchParams\(true\)/);
  assert.match(runtime, /refreshedLaunchParams !== signedLaunchParams/);
});

test('VK session restore stays scoped to signed vk_user_id and does not reuse Telegram/global sessions', async () => {
  const runtime = await read('vk-platform.js');
  const app = await read('app.js');

  assert.match(runtime, /let launchVkUserId = String\(launchSearch\.get\('vk_user_id'\) \|\| ''\)\.trim\(\)/);
  assert.match(runtime, /let storagePrefix = `pivnik_vk_\$\{launchVkUserId \|\| 'unknown'\}_`/);
  assert.match(runtime, /window\.__PIVNIK_STORAGE_PREFIX__ = storagePrefix/);
  assert.match(runtime, /localStorage\.removeItem\('pivnik_session'\)/);
  assert.match(runtime, /localStorage\.removeItem\('pivnik_staff_session'\)/);

  // Canonical startup may replace an unknown/stale launch identity only after signed auth succeeds.
  assert.match(runtime, /function acceptAuthenticatedIdentity\(signedLaunchParams\)/);
  assert.match(runtime, /launchVkUserId = userId/);
  assert.match(runtime, /storagePrefix = `pivnik_vk_\$\{userId\}_`/);

  // Valid account-scoped keys must survive startup so returning VK users can restore sessions.
  assert.doesNotMatch(runtime, /localStorage\.removeItem\(`\$\{storagePrefix\}session`\)/);
  assert.doesNotMatch(runtime, /localStorage\.removeItem\(`\$\{storagePrefix\}staff_session`\)/);

  assert.match(app, /function localStorageKey\(key\)/);
  assert.match(app, /window\.__PIVNIK_STORAGE_PREFIX__ \|\| 'pivnik_tg_'/);
  assert.match(app, /String\(key\)\.replace\(\/\^pivnik_\//);
  assert.match(app, /safeStorage\.set\('pivnik_session', state\.token\)/);
});

test('VK profile data is rejected when Bridge user differs from signed launch user', async () => {
  const runtime = await read('vk-platform.js');
  assert.match(runtime, /(vkUser|profile)\?\.id && launchVkUserId && String\(\1\.id\) !== launchVkUserId/);
  assert.match(runtime, /VK profile does not match signed launch parameters; profile data ignored/);
  assert.match(runtime, /(?:return null|vkUser = null)/);
});

test('VK hosting bundle suppresses only the redundant delayed consent reload', async () => {
  const builder = await read('scripts/build-vk-hosting.mjs');
  assert.match(builder, /function patchVkAccountLinkRuntime\(source\)/);
  assert.match(builder, /accepted && platform !== 'vk'/);
  assert.match(builder, /window\.setTimeout\(\(\) => window\.location\.reload\(\), 650\)/);
  assert.match(builder, /legacyConsentReload/);
  assert.match(builder, /safeConsentReload/);
});
