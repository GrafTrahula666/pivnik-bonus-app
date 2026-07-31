import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('Новые достижения ждут явного открытия пользователем', async () => {
  const accountLink = await source('account-link.js');

  assert.match(accountLink, /pathname === '\/api\/achievements'/);
  assert.match(accountLink, /pendingAchievements = data\.unannouncedAchievements/);
  assert.match(accountLink, /У вас новое достижение/);
  assert.match(accountLink, /Нажмите, чтобы открыть и получить/);
  assert.match(accountLink, /if \(!achievementInboxOpened\) return undefined/);
  assert.match(accountLink, /#openAchievementsButton, #achievementEmptyOpen, \[data-profile-achievement\]/);
  assert.match(accountLink, /originalAchievementCelebration\?\.\(\)/);
  assert.doesNotMatch(accountLink, /MutationObserver/);
});
