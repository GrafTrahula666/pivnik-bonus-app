import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { drawWheelPrize, WHEEL_TICKET_COUNT } from '../wheel.js';
const read = (p) => readFile(new URL('../' + p, import.meta.url), 'utf8');

test('retired raffle cannot award new tickets through wheel, regardless of season flag', () => {
  const beer = (min, max) => max === WHEEL_TICKET_COUNT ? 480_000 : 0;
  assert.equal(drawWheelPrize(beer).prize.code, 'beer-glass');
  assert.equal(drawWheelPrize(beer, { halloween: true }).prize.code, 'beer-glass');
});

test('retired ticket flows are absent in both server runtimes and client UI', async () => {
  const [server, gateway, app, index] = await Promise.all(['server.js', 'universal-server.js', 'app.js', 'index.html'].map(read));
  for (const runtime of [server, gateway]) {
    assert.doesNotMatch(runtime, /from ['"]\.\/halloween-(?:invite|raffle)\.js['"]/);
    assert.doesNotMatch(runtime, /(?:recordHalloweenPurchase|grantHalloweenTickets|runHalloweenHook|halloweenAfterPurchase)/);
    assert.doesNotMatch(runtime, /\/api\/halloween\//);
  }
  assert.doesNotMatch(app, /\/api\/halloween\//);
  assert.doesNotMatch(app, /openHalloweenPage|claimHalloweenInvite|schedulePromoBanner/);
  assert.doesNotMatch(index, /data-screen="halloween"|halloweenInviteModal|promoBannerTickets|halloweenTickets/);
});
