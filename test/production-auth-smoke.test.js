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

test('production auth smoke performs no bonus or purchase mutations', () => {
  assert.doesNotMatch(source, /api\/(wheel\/spin|me\/consent|staff\/transaction|shop\/purchase)/);
  assert.match(source, /productionDataCreated:\s*false/);
  assert.match(source, /bonusOperationsCreated:\s*false/);
});
