import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const [ui, css, app, html] = await Promise.all([
  fs.readFile(new URL('../red-cosmos-v2.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../red-cosmos-v2.css', import.meta.url), 'utf8'),
  fs.readFile(new URL('../app.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../index.html', import.meta.url), 'utf8')
]);

test('interaction fallback is shared by Telegram and VK and runs in capture phase', () => {
  assert.match(ui, /function installInteractionFallback\(\)/);
  assert.doesNotMatch(ui, /function installVkInteractionFallback\(\)/);
  assert.match(ui, /window\.__RED_COSMOS_INTERACTIONS__/);
  assert.match(ui, /window\.addEventListener\('click',[\s\S]*true\);/);
  assert.doesNotMatch(ui, /if \(!isVk\(\).*INTERACTIONS/);
});

test('both platforms force hit-testing and five-column bottom navigation', () => {
  assert.match(css, /:is\(\.platform-vk,\.platform-telegram\)[\s\S]*pointer-events:none!important/);
  assert.match(css, /:is\(\.platform-vk,\.platform-telegram\)[\s\S]*button:not\(:disabled\)[\s\S]*pointer-events:auto!important/);
  assert.match(css, /:is\(\.platform-vk,\.platform-telegram\) \.bottom-nav \{ grid-template-columns:repeat\(5/);
  assert.match(css, /:is\(\.platform-vk,\.platform-telegram\) \.modal\.open \{ display:flex!important; pointer-events:auto!important; z-index:10000!important; \}/);
});

test('critical client and service navigation has a safe state-repair fallback', () => {
  for (const screenId of [
    'openPromosButton',
    'openLeaderboardButton',
    'profileStaffNav',
    'profileAdminNav',
    'backToProfileFromStaff',
    'backToProfileFromAdmin',
    'openWheelButton'
  ]) assert.match(ui, new RegExp(screenId));

  for (const modalId of [
    'navQrButton',
    'openShopButton',
    'openStatuses',
    'openHelpButton',
    'openWheelRulesButton',
    'openProfileSettings',
    'openProfileAvatar',
    'openProfileFrames',
    'openProfilePrivacy',
    'openAchievementsButton',
    'openProfileAchievements',
    'openProfileStatistics',
    'openNotifications',
    'openDeleteAccount'
  ]) assert.match(ui, new RegExp(modalId));

  assert.match(ui, /target\.dataset\.close/);
  assert.match(ui, /forceCloseModal\(closeId\)/);
});

test('fallback does not duplicate non-idempotent money or staff operations', () => {
  for (const dangerousId of [
    'createSale',
    'wheelSpinButton',
    'buyShopItem',
    'deleteAccountButton',
    'saveContentItem',
    'adjustBalance'
  ]) assert.doesNotMatch(ui, new RegExp(`\\b${dangerousId}\\b`));
});

test('materialized Telegram client never globally kills every app click for stale consent state', () => {
  assert.doesNotMatch(app, /^document\.addEventListener\('click',\s*blockUnacceptedAction,\s*true\);$/m);
  assert.match(app, /RED_COSMOS_NO_GLOBAL_CLICK_BLOCKER/);
  assert.match(app, /#acceptTerms[\s\S]*addEventListener\('click'/);
});

test('production HTML exposes the five expected bottom navigation controls and app has normal handlers too', () => {
  for (const target of ['client', 'actions', 'league', 'profile']) {
    assert.match(html, new RegExp(`data-target="${target}"`));
  }
  assert.match(html, /id="navQrButton"/);
  assert.match(app, /\.bottom-nav \[data-target\][\s\S]*addEventListener\('click'/);
  assert.match(app, /#navQrButton[\s\S]*addEventListener\('click'/);
  assert.match(app, /#profileStaffNav[\s\S]*switchScreen\('staff'\)/);
  assert.match(app, /#profileAdminNav[\s\S]*switchScreen\('admin'\)/);
});
