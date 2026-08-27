import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

// Release invariant: platforms are independent, while the leaderboard remains shared.
const [pkgText, gateway, accountLink, app, workflow] = await Promise.all([
  fs.readFile(new URL('../package.json', import.meta.url), 'utf8'),
  fs.readFile(new URL('../universal-server.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../account-link.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../app.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../.github/workflows/release-gate.yml', import.meta.url), 'utf8')
]);

const pkg = JSON.parse(pkgText);

test('release materialization verifies platform separation, safety and v22 fail-closed patches', () => {
  assert.match(pkg.scripts.materialize, /^node scripts\/materialize-runtime-patches\.mjs/);
  assert.match(pkg.scripts.materialize, /apply-v22-preflight-fixes\.mjs/);
  assert.match(pkg.scripts.materialize, /apply-v22-product-rebuild\.mjs/);
  assert.match(pkg.scripts.materialize, /apply-v22-special-achievement\.mjs/);
  assert.match(pkg.scripts.check, /node --check scripts\/apply-platform-separation\.mjs/);
  assert.match(pkg.scripts.check, /node --check scripts\/apply-platform-separation-safety\.mjs/);
  assert.match(pkg.scripts.check, /node --check scripts\/apply-platform-profile-refresh\.mjs/);
  assert.match(pkg.scripts.check, /node --check scripts\/verify-platform-separation-production\.mjs/);
  assert.equal(pkg.scripts['verify:platform-separation'], 'node scripts/verify-platform-separation-production.mjs');
  assert.equal(pkg.scripts['verify:cross-platform'], undefined);
});

test('new VK and Telegram identities are not auto-merged', () => {
  assert.match(gateway, /const PLATFORM_ACCOUNT_MODE = 'separate';/);
  assert.doesNotMatch(
    gateway,
    /if \(!userId && isOwner && provider === 'vk' && ownerTelegramId\)/
  );
  assert.match(
    gateway,
    /VK and Telegram identities are intentionally independent, including the owner/
  );
  assert.match(gateway, /accountLinked: false/);
  assert.match(gateway, /accountMode: PLATFORM_ACCOUNT_MODE/);
});

test('public account-link API and UI are disabled', () => {
  assert.match(gateway, /VK и Telegram работают как отдельные аккаунты\. Объединение отключено\./);
  assert.match(gateway, /linkCodes: false/);
  assert.match(accountLink, /Account linking is intentionally unavailable/);
  assert.doesNotMatch(
    accountLink,
    /DOMContentLoaded'[\s\S]{0,120}injectInterface\(\)/
  );
});

test('deletion is platform-specific and preserves the other legacy identity', () => {
  assert.match(gateway, /async function deletePlatformAccount\(/);
  assert.match(gateway, /preservedOtherPlatform: true/);
  assert.match(gateway, /deletePlatformAccount\(user\.id, platform, user\.payload\.pid, body\.confirmation\)/);
  assert.doesNotMatch(gateway, /await deleteUnifiedAccount\(user\.id, body\.confirmation\)/);
});

test('a surviving standalone platform refreshes its own profile fields', () => {
  assert.match(gateway, /Separate platform profile refresh 2026-08-07/);
  assert.match(gateway, /const shouldUpdateMainProfile = identityCountValue <= 1;/);
});

test('the shared Telegram and VK leaderboard remains available', () => {
  assert.match(gateway, /scope: 'telegram-vk'/);
  assert.match(gateway, /async function getUnifiedMonthlyLeaderboard/);
});

test('admin list shows platform provenance and only suggests possible matches', () => {
  assert.match(app, /Возможное совпадение:/);
  assert.match(app, /только подсказка, без объединения/);
  assert.match(app, /архивная связка/);
});

test('post-deploy gate is read-only and cannot merge production accounts', () => {
  assert.match(workflow, /Verify separate Telegram and VK production accounts/);
  assert.match(workflow, /verify-platform-separation-production\.mjs/);
  assert.doesNotMatch(workflow, /railway-cross-platform-e2e\.mjs/);
  assert.doesNotMatch(workflow, /PIVNIK_CROSS_PLATFORM_E2E_CONFIRM/);
});
