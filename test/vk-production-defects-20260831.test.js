import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const read = (name) => fs.readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('VK avatar hydration retries on slow devices without erasing stored photo or selected collection avatar', async () => {
  const [vkPlatform, gateway] = await Promise.all([read('vk-platform.js'), read('universal-server.js')]);
  assert.match(vkPlatform, /VK_PROFILE_SYNC_RETRY_DELAYS_MS\s*=\s*\[0, 1400, 3600\]/);
  assert.match(vkPlatform, /async function requestVkUserInfo\(\)/);
  assert.match(vkPlatform, /for \(const retryDelay of VK_PROFILE_SYNC_RETRY_DELAYS_MS\)/);
  assert.match(gateway, /photo_url = COALESCE\(\$5, photo_url\)/);
  assert.match(gateway, /AND onboarding_completed_at IS NULL[\s\S]*?AND avatar_source IN \('preset_male', 'preset_female'\)/);
  assert.match(gateway, /avatar_source = \$1::text,[\s\S]*?avatar_key = \$2::text/);
});

test('VK bottom navigation contains the QR button inside one safe-area aware panel without the legacy notch', async () => {
  const css = await read('red-cosmos-v2.css');
  assert.match(css, /PIVNIK_VK_BOTTOM_NAV_SAFE_AREA_20260831/);
  assert.match(css, /\.platform-vk \.bottom-nav::before\s*\{[\s\S]*?content:none!important;[\s\S]*?display:none!important;/);
  assert.match(css, /\.platform-vk \.bottom-nav \.qr-nav-button > span\s*\{[\s\S]*?margin-top:0!important;/);
  assert.match(css, /padding:7px 7px max\(7px, env\(safe-area-inset-bottom\)\)!important/);
});

test('VK service screens are visible only for authorized roles and direct UI navigation is guarded', async () => {
  const [app, gateway] = await Promise.all([read('app.js'), read('universal-server.js')]);
  assert.match(app, /const roleCanStaff = \(role\) => \['staff', 'admin'\]\.includes\(role\)/);
  assert.match(app, /const roleCanAdmin = \(role\) => \['viewer', 'admin'\]\.includes\(role\)/);
  assert.match(app, /if \(target === 'staff' && !roleCanStaff\(state\.profile\?\.role\)\) return;/);
  assert.match(app, /if \(target === 'admin' && !roleCanAdmin\(state\.profile\?\.role\)\) return;/);
  assert.match(app, /#profileStaffNav'\)\?\.classList\.toggle\('hidden', !hasStaffAccess\)/);
  assert.match(app, /#profileAdminNav'\)\?\.classList\.toggle\('hidden', !hasAdminAccess\)/);
  assert.match(gateway, /!\['viewer', 'admin'\]\.includes\(profile\.role\)/);
  assert.match(gateway, /!\['staff', 'admin'\]\.includes\(\(await getProfile\(user\.id\)\)\.role\)/);
});

test('VK client no longer creates the redundant personal QR plaque while QR logic remains intact', async () => {
  const [app, html, css] = await Promise.all([read('app.js'), read('index.html'), read('red-cosmos-v2.css')]);
  assert.doesNotMatch(app, /Один личный код/);
  assert.doesNotMatch(app, /hero\.after\(tip\)/);
  assert.match(html, /id="qrImage"/);
  assert.match(html, /id="qrToken"/);
  assert.match(app, /\$\('#qrToken'\)\.textContent = data\.shortCode/);
  assert.match(css, /\.platform-vk #qrToken/);
});
