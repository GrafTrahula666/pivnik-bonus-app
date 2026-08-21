import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('Telegram launch recovers signed initData from SDK or launch URL without bridge flooding', async () => {
  const [app, index] = await Promise.all([source('app.js'), source('index.html')]);

  assert.match(app, /location\.hash\.slice\(1\)/);
  assert.match(app, /location\.search\.slice\(1\)/);
  assert.match(app, /get\('tgWebAppData'\)/);
  assert.match(app, /bridge\?\.initData \|\| telegramInitDataFromUrl/);
  assert.match(app, /telegramBridgeInitialized/);
  assert.match(index, /app\.js\?v=[A-Za-z0-9._-]+/);
});

test('Telegram auth limits valid identities separately and throttles only invalid IP attempts', async () => {
  const gateway = await source('universal-server.js');

  assert.match(gateway, /auth-identity:telegram:\$\{user\.id\}/);
  assert.match(gateway, /auth-invalid:\$\{requestAddress\(req\)\}:\$\{platform\}/);
  assert.doesNotMatch(gateway, /`auth:\$\{requestAddress\(req\)\}:\$\{platform\}`/);
});

test('Achievement notifications have one owner and consent copy never installs a DOM observer', async () => {
  const [accountLink, app] = await Promise.all([source('account-link.js'), source('app.js')]);

  assert.doesNotMatch(accountLink, /pendingAchievements|achievementInboxOpened|maybeShowAchievementCelebration/);
  assert.match(app, /async function dismissAchievementNotification\(\)/);
  assert.match(app, /acknowledgedAchievementCodes/);
  assert.match(app, /window\.setTimeout\(maybeShowAchievementCelebration, 0\)/);
  assert.doesNotMatch(accountLink, /MutationObserver/);
});
