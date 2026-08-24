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
});

test('production auth smoke reuses persistent profiles without bonus writes', () => {
  assert.match(source, /FROM user_identities/);
  assert.match(source, /u\.qr_token IS NOT NULL/);
  assert.doesNotMatch(source, /INSERT\s+INTO/i);
  assert.doesNotMatch(source, /UPDATE\s+(users|wallets|transactions|reward_grants)/i);
  assert.doesNotMatch(source, /api\/(wheel\/spin|me\/consent|staff\/transaction|shop\/purchase)/);
  assert.match(source, /productionDataCreated:\s*false/);
  assert.match(source, /bonusOperationsCreated:\s*false/);
});
