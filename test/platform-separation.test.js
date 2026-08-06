import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const [pkgText, gateway, accountLink, app] = await Promise.all([
  fs.readFile(new URL('../package.json', import.meta.url), 'utf8'),
  fs.readFile(new URL('../universal-server.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../account-link.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../app.js', import.meta.url), 'utf8')
]);

const pkg = JSON.parse(pkgText);

test('release materialization applies platform separation', () => {
  assert.match(pkg.scripts.materialize, /apply-platform-separation\.mjs/);
  assert.match(pkg.scripts.check, /node --check scripts\/apply-platform-separation\.mjs/);
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

test('the shared Telegram and VK leaderboard remains available', () => {
  assert.match(gateway, /scope: 'telegram-vk'/);
  assert.match(gateway, /async function getUnifiedMonthlyLeaderboard/);
});

test('admin list shows platform provenance and only suggests possible matches', () => {
  assert.match(app, /Возможное совпадение:/);
  assert.match(app, /только подсказка, без объединения/);
  assert.match(app, /архивная связка/);
});
