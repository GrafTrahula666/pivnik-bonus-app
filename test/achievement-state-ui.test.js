import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('locked achievements stay in the catalog but never enter the profile', async () => {
  const [app, styles, index] = await Promise.all([
    source('app.js'),
    source('styles.css'),
    source('index.html')
  ]);

  assert.match(app, /const items = state\.achievements\.filter\(\(item\) => item\.rarity === rarity\)/);
  assert.doesNotMatch(app, /profile\?\.achievements[\s\S]{0,180}rarity === 'legendary'/);
  assert.match(app, /const achievements = state\.profile\?\.achievements \|\| \[\]/);
  assert.match(app, /item\.type === 'unique'[\s\S]{0,100}'Заблокировано'/);
  assert.match(styles, /\.achievement-tile\.earned\.rarity-legendary/);
  assert.match(styles, /\.achievement-tile\.locked\.rarity-legendary[\s\S]{0,180}rgba\(255,255,255/);
  assert.match(index, /id="achievementDetailsModal"/);
  assert.match(index, /id="achievementDetailsCondition"/);
  assert.match(index, /id="achievementDetailsReward"/);
});

test('notification dismissal acknowledges the durable grant before closing', async () => {
  const [app, accountLink, index] = await Promise.all([
    source('app.js'),
    source('account-link.js'),
    source('index.html')
  ]);

  const dismissStart = app.indexOf('async function dismissAchievementNotification()');
  const dismissEnd = app.indexOf('function maybeShowAchievementCelebration()', dismissStart);
  const dismiss = app.slice(dismissStart, dismissEnd);
  assert.match(dismiss, /await acknowledgeAchievement\(code\)[\s\S]*?closeModal\('achievementCelebrationModal'\)/);
  assert.match(app, /acknowledgedAchievementCodes\.add/);
  assert.match(app, /filterAcknowledgedAchievements/);
  assert.match(app, /achievementRevision/);
  assert.match(index, /id="dismissAchievementButton"/);
  assert.doesNotMatch(accountLink, /pendingAchievements|achievementInboxOpened|maybeShowAchievementCelebration/);
});

test('profile and catalog API responses use the same earned grant snapshot', async () => {
  const [achievements, server, gateway, migration] = await Promise.all([
    source('achievements.js'),
    source('server.js'),
    source('universal-server.js'),
    source('migrations/007_achievement_source_of_truth.sql')
  ]);

  assert.match(achievements, /FOR UPDATE/);
  assert.match(achievements, /ON CONFLICT \(code, user_id\) DO NOTHING/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_reward_grants_achievement_identity/);
  assert.doesNotMatch(server, /achievementsFromRow|beta_number/);
  assert.doesNotMatch(gateway, /achievementsFromRow|beta_number/);
  assert.match(server, /profileAchievements: state\.earned/);
  assert.match(gateway, /profileAchievements: state\.earned/);
  assert.match(gateway, /achievements: achievementState\.earned/);
  assert.match(gateway, /getUserAchievementState\(db, canonical\)/);
});
