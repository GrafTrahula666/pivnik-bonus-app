import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../scripts/railway-production-auth-smoke.mjs', import.meta.url),
  'utf8'
);
const runtimeRepair = await readFile(
  new URL('../scripts/repair-telegram-runtime.mjs', import.meta.url),
  'utf8'
);

test('production auth smoke signs both platforms and checks repeat login state', () => {
  assert.match(source, /telegramInitData/);
  assert.match(source, /vkLaunchParams/);
  assert.match(source, /authenticateTwice/);
  assert.match(source, /waitForReleaseReadiness/);
  assert.match(source, /Date\.now\(\) \+ 2 \* 60_000/);
  assert.match(source, /const telegramUrl = productionUrl\('telegram'\)/);
  assert.match(source, /const vkUrl = productionUrl\('vk'\)/);
  assert.doesNotMatch(source, /productionUrl\('vk', vkVariables\.VK_APP_URL\)/);
  assert.match(source, /profile state changed after repeated authentication/);
  assert.match(source, /qrShortCode/);
  assert.match(source, /achievementCodes/);
});

test('production auth smoke reuses persistent profiles without bonus writes', () => {
  assert.match(source, /const CANARIES/);
  assert.match(source, /pivnik_release_telegram/);
  assert.match(source, /pivnik_release_vk/);
  assert.doesNotMatch(source, /INSERT\s+INTO/i);
  assert.doesNotMatch(source, /UPDATE\s+(users|wallets|transactions|reward_grants)/i);
  assert.doesNotMatch(source, /api\/(wheel\/spin|me\/consent|staff\/transaction|shop\/purchase)/);
  assert.match(source, /productionDataCreated:\s*false/);
  assert.match(source, /bonusOperationsCreated:\s*false/);
  assert.match(runtimeRepair, /releaseCanaries/);
  assert.match(runtimeRepair, /profile_public = FALSE/);
  assert.match(runtimeRepair, /release canary identity belongs to another user/);
});
