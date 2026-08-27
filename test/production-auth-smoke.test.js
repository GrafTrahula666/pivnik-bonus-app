import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../scripts/railway-production-auth-smoke.mjs', import.meta.url),
  'utf8'
);

test('production auth smoke signs both platforms and checks repeat login state', () => {
  assert.match(source, /telegramInitData/);
  assert.match(source, /vkLaunchParams/);
  assert.match(source, /authenticateTwice/);
  assert.match(source, /profile state changed after repeated authentication/);
  assert.match(source, /qrShortCode/);
  assert.match(source, /achievementCodes/);
  assert.match(source, /RAILWAY_PRODUCTION\.services\.telegram/);
  assert.match(source, /RAILWAY_PRODUCTION\.services\.vk/);
});

test('production smoke verifies the four-item shop, local artwork, shared wheel route and league on both platforms', () => {
  assert.match(source, /RED_COSMOS_SHOP_CODES/);
  assert.match(source, /api\/shop\/catalog/);
  assert.match(source, /api\/wheel\/status/);
  assert.match(source, /api\/leaderboard\/monthly/);
  assert.match(source, /shop catalog must contain exactly the four RED COSMOS frames/);
  assert.match(source, /wheel status returned 404/);
  assert.match(source, /shopArtworkLoaded/);
  assert.match(source, /safeFeatureSmoke\(\{ platform: 'telegram'/);
  assert.match(source, /safeFeatureSmoke\(\{ platform: 'vk'/);
});

test('production auth smoke performs no bonus, shop purchase or wheel-spin mutations', () => {
  assert.doesNotMatch(source, /api\/(wheel\/spin|me\/consent|staff\/transaction|shop\/buy|shop\/purchase)/);
  assert.match(source, /productionDataCreated:\s*false/);
  assert.match(source, /bonusOperationsCreated:\s*false/);
  assert.match(source, /mutatingFeatureOperationsCreated:\s*false/);
});
