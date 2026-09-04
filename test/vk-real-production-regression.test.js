import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('VK photo choice stays actionable and refreshes the signed VK profile on demand', () => {
  const app = read('app.js');
  const vk = read('vk-platform.js');
  assert.match(vk, /window\.__PIVNIK_VK_REFRESH_PROFILE__ = refreshVkProfileOnDemand/);
  assert.match(vk, /const profile = await requestVkUserInfo\(\)/);
  assert.match(vk, /launchParams: signedLaunchParams/);
  assert.match(vk, /pivnik:vk-profile-hydrated/);
  assert.match(app, /button\.disabled = !hasPlatformPhoto && !IS_VK/);
  assert.match(app, /Нажмите, чтобы загрузить фото VK/);
  assert.match(app, /const refresh = window\.__PIVNIK_VK_REFRESH_PROFILE__/);
});

test('VK owner access remains server-authorized through OWNER_VK_ID', () => {
  const gateway = read('universal-server.js');
  const app = read('app.js');
  assert.match(gateway, /process\.env\.OWNER_VK_ID/);
  assert.match(gateway, /isConfiguredOwnerIdentity\(provider, externalUser\.id/);
  assert.match(app, /roleCanStaff\(profile\.role\)/);
  assert.match(app, /roleCanAdmin\(profile\.role\)/);
});

test('VK deep-space background is visible instead of being covered by page canvases', () => {
  const css = read('red-cosmos-v2.css');
  assert.match(css, /PIVNIK_VK_COSMOS_BACKGROUND_20260831/);
  assert.match(css, /html\.platform-vk body \{/);
  assert.match(css, /luxury-vip-space\.webp\?v=17\.1-vk/);
  assert.match(css, /filter:brightness\(1\.72\) saturate\(1\.22\) contrast\(1\.06\)/);
  assert.match(css, /html\.platform-vk #appShell>main/);
  assert.match(css, /html\.platform-vk \.screen/);
  assert.match(css, /background:transparent!important/);
  assert.match(css, /html\.platform-vk body::before/);
  assert.match(css, /content:none!important/);
});
