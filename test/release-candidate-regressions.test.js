import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);
const read = (name) => readFile(new URL(name, ROOT), 'utf8');

test('release candidate: final repair is wired into materialize and prestart', async () => {
  const pkg = JSON.parse(await read('package.json'));
  for (const key of ['prestart', 'materialize']) {
    assert.match(pkg.scripts[key], /apply-release-candidate-fixes\.mjs/);
    assert.ok(pkg.scripts[key].indexOf('apply-release-candidate-fixes.mjs') > pkg.scripts[key].indexOf('apply-red-cosmos-v2-tester-claims.mjs'));
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

test('release candidate: VK hides technical QR token/copy control without deleting QR logic', async () => {
  const [css, html, app] = await Promise.all([read('red-cosmos-v2.css'), read('index.html'), read('app.js')]);
  assert.match(css, /\.platform-vk #qrToken,\.platform-vk #copyQrCode\{display:none!important\}/);
  assert.match(html, /id="qrToken"/);
  assert.match(app, /\$\('#qrToken'\)\.textContent = data\.shortCode/);
});

test('release candidate: materializer accepts repeated RED COSMOS materialization', async () => {
  const materializer = await read('scripts/materialize-runtime-patches.mjs');
  assert.match(materializer, /supportedAppVersion/);
  assert.match(materializer, /19\.1-telegram-wheel-v2/);
  assert.match(materializer, /2\.0-red-cosmos/);
});
