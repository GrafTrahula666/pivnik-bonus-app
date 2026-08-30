import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../red-cosmos-v2.css', import.meta.url), 'utf8');
const overlay = fs.readFileSync(new URL('../red-cosmos-v2.js', import.meta.url), 'utf8');

test('VK wheel artwork is not disabled by platform guard', () => {
  assert.match(app, /function renderWheelArtwork\(\) \{\s*if \(state\.wheel\.artworkReady\) return;/);
  assert.doesNotMatch(app, /if \(IS_VK \|\| state\.wheel\.artworkReady\) return;/);
});

test('VK personal QR technical short-code controls stay hidden', () => {
  assert.match(css, /\.platform-vk\s+#qrToken/);
  assert.match(css, /\.platform-vk\s+#copyQrCode/);
});

test('VK fallback layer exists', () => {
  assert.match(overlay, /function installVkInteractionFallback\(\)/);
});

const vkPlatform = fs.readFileSync(new URL('../vk-platform.js', import.meta.url), 'utf8');

test('VK signed auth never waits for Bridge profile and hydrates photo in background', () => {
  assert.match(vkPlatform, /const signedLaunchParams = await resolveLaunchParams\(\);[\s\S]*?let response = await sendAuth\(signedLaunchParams\);/);
  assert.doesNotMatch(vkPlatform, /const signedLaunchParams = await resolveLaunchParams\(\);[\s\S]{0,240}?await profileReady;[\s\S]{0,240}?sendAuth/);
  assert.match(vkPlatform, /function scheduleVkProfileSync\(signedLaunchParams\)/);
  assert.match(vkPlatform, /profileReady\.then\(async \(profile\) =>/);
  assert.match(vkPlatform, /pivnik:vk-profile-hydrated/);
  assert.match(app, /function applyVkProfileHydration\(data\)/);
});

test('profile frame picker renders the real selected avatar inside each frame', () => {
  assert.match(app, /const previewEntity = \{ \.\.\.selectedAvatarPreview\(\), profileFrame: frame\.code \};/);
  assert.match(app, /avatarInlineHtml\(previewEntity, 'frame-choice-avatar'\)/);
  assert.match(css, /\.profile-frame-choice \.frame-choice-avatar/);
});

test('achievement hub explicitly refreshes the catalog when background preload has not finished', () => {
  assert.match(app, /openAchievements\(\);\s*if \(!state\.achievementsLoaded\) \{\s*void loadAchievements\(\)\.catch/);
});

test('VK home achievement and shop cards use an equal two-column grid', () => {
  assert.match(css, /\.platform-vk \.home-feature-grid \{[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important;/);
  assert.match(css, /\.platform-vk \.home-achievement-card,[\s\S]*?\.platform-vk \.home-shop-card[\s\S]*?min-height:196px!important;/);
});

test('authorized VK service controls are promoted near profile shortcuts without changing role checks', () => {
  assert.match(app, /const hasStaffAccess = roleCanStaff\(profile\.role\);/);
  assert.match(app, /const hasAdminAccess = roleCanAdmin\(profile\.role\);/);
  assert.match(app, /IS_VK && serviceAccess && \(hasStaffAccess \|\| hasAdminAccess\)/);
  assert.match(app, /insertAdjacentElement\('afterend', serviceAccess\)/);
  assert.match(overlay, /profileStaffNav: 'staff'/);
  assert.match(overlay, /profileAdminNav: 'admin'/);
});

test('VK app shell replaces the legacy luxury background with RED COSMOS', () => {
  assert.match(css, /\.platform-vk \.app-shell::before \{[\s\S]*?linear-gradient\(145deg,#090002/);
  const vkBackgroundBlock = css.match(/\.platform-vk \.app-shell::before \{[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(vkBackgroundBlock, /luxury-vip-space/);
});

test('VK client avatar renderer accepts both legacy and explicit VK profile-photo sources', () => {
  assert.match(app, /source === 'telegram' \|\| source === 'vk'/);
});

test('VK help no longer tells clients that a visible short code sits under the QR', () => {
  assert.match(overlay, /короткий код\|указан\[\^\.\]\*под QR/);
  assert.match(overlay, /служебный ручной ввод/);
});

const crypto = await import('node:crypto');
const workingUpdateScript = fs.readFileSync(new URL('../scripts/apply-working-updates.mjs', import.meta.url), 'utf8');
const historicalMigration007 = fs.readFileSync(new URL('../migrations/007_red_cosmos_v2.sql', import.meta.url), 'utf8');
const followupMigration008 = fs.readFileSync(new URL('../migrations/008_tester_recipient_aliases.sql', import.meta.url), 'utf8');

test('working updates never rewrite applied migration 007 and use follow-up migration 008', () => {
  const checksum = crypto.createHash('sha256').update(historicalMigration007).digest('hex');
  assert.equal(checksum, '0e3a5dd048705b9eb445d25eb3083a1c8e123950035ed38b608a261f1f301a07');
  assert.match(workingUpdateScript, /delete runtimeFiles\['migrations\/007_red_cosmos_v2\.sql'\]/);
  assert.match(followupMigration008, /INSERT INTO pending_special_achievement_recipients/);
  assert.match(followupMigration008, /'olesyaolese'/);
  assert.match(followupMigration008, /p\.handle = 'drolted' AND normalized_username = 'drollted'/);
});
