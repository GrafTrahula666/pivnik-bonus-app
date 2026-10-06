import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);
const read = (name) => readFile(new URL(name, ROOT), 'utf8');

test('release candidate: final repair is wired into materialize and prestart', async () => {
  const pkg = JSON.parse(await read('package.json'));
  for (const key of ['prestart', 'materialize']) {
    assert.match(pkg.scripts[key], /apply-release-candidate-fixes\.mjs/);
    assert.ok(pkg.scripts[key].indexOf('apply-release-candidate-fixes.mjs') > pkg.scripts[key].indexOf('apply-red-cosmos-v2-backend-final.mjs'));
  }
});

test('release candidate: core assets are root absolute and Telegram actions remain', async () => {
  const [gateway, html] = await Promise.all([read('universal-server.js'), read('index.html')]);
  assert.match(gateway, /href="\/styles\.css\$1"/);
  assert.match(gateway, /src="\/app\.js\$1"/);
  assert.doesNotMatch(gateway, /if \(platform !== 'vk'\)[\s\S]{0,240}telegram-wheel-legacy:start/);
  assert.match(gateway, /platform === 'vk' \? 'platform-vk' : 'platform-telegram'/);
  assert.match(html, /id="openShopButton"/);
  assert.match(html, /id="openProfileShop"/);
});

test('release candidate: navigation uses NodeLists and profile shop is wired', async () => {
  const app = await read('app.js');
  assert.match(app, /\$\$\('\.screen'\)\.forEach/);
  assert.match(app, /\$\$\('\.bottom-nav \[data-target\]'\)\.forEach/);
  assert.doesNotMatch(app, /(?<!\$)\$\('\.screen'\)\.forEach/);
  assert.doesNotMatch(app, /(?<!\$)\$\('\.bottom-nav \[data-target\]'\)\.forEach/);
  assert.match(app, /\$\('#openProfileShop'\)\?\.addEventListener\('click'/);
});

test('release candidate: QR token logic stays intact', async () => {
  const [html, app] = await Promise.all([read('index.html'), read('app.js')]);
  assert.match(html, /id="qrToken"/);
  assert.match(app, /\$\('#qrToken'\)\.textContent = data\.shortCode/);
});

test('release candidate: materializer accepts repeated RED COSMOS materialization', async () => {
  const materializer = await read('scripts/materialize-runtime-patches.mjs');
  assert.match(materializer, /supportedAppVersion/);
  assert.match(materializer, /19\.1-telegram-wheel-v2/);
  assert.match(materializer, /2\.0-red-cosmos/);
});

test('pending tester achievement claims live in canonical gateway source and run on login', async () => {
  const gateway = await read('universal-server.js');
  assert.match(gateway, /async function claimPendingSpecialAchievement\(userId, provider, externalUser\)/);
  assert.match(gateway, /pivnik_claim_pending_special_achievement\(\$1::bigint,\$2::text,\$3::text,\$4::text\)/);
  assert.match(gateway, /\{ pid: String\(externalUser\.id\) \}\s*\);\s*await claimPendingSpecialAchievement\(userId, provider, externalUser\);/);
  const pkg = JSON.parse(await read('package.json'));
  for (const key of ['prestart', 'materialize', 'check']) {
    assert.doesNotMatch(pkg.scripts[key], /apply-red-cosmos-v2-tester-claims/);
  }
});
