import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Anna personal frame remains an entitlement after role or identity changes', async () => {
  const [gateway, server] = await Promise.all([
    read('universal-server.js'),
    read('server.js')
  ]);
  for (const source of [gateway, server]) {
    assert.match(source, /Anna frame entitlement and consent persistence hotfix 2026-08-06/);
    assert.match(source, /isAnnaRow\(row\) \|\| String\(row\?\.profile_frame \|\| row\?\.profileFrame \|\| ''\) === 'anna'/);
    assert.match(source, /if \(storedFrame === 'anna'\) return 'anna';/);
    assert.doesNotMatch(source, /if \(storedFrame === 'anna'\) return 'none';/);
    assert.match(source, /code: 'anna', title: 'Персональная рамка Анны'/);
    assert.match(source, /storedFrame === 'olesya'/);
    assert.match(source, /storedFrame === 'vladislav'/);
  }
});

test('VK waits for canonical profile before reopening consent', async () => {
  const source = await read('vk-platform.js');
  assert.match(source, /inspectApiResponse\(response, \{ allowOpen = true \} = \{\}\)/);
  assert.match(source, /await inspectApiResponse\(response, \{ allowOpen: false \}\)/);
  assert.match(source, /await inspectApiResponse\(response, \{ allowOpen: true \}\)/);
  assert.doesNotMatch(source, /void inspectApiResponse\(response\);/);
});

test('Production repair is guarded and copies only previously explicit consent', async () => {
  const source = await read('scripts/railway-repair-anna-frame-and-consent.mjs');
  assert.match(source, /REPAIR_ANNA_FRAME_AND_CONSENT_20260806/);
  assert.match(source, /terms_accepted_at IS NOT NULL/);
  assert.match(source, /terms_version = \$1/);
  assert.match(source, /profile_frame = 'anna'/);
  assert.match(source, /no production data was changed/);
});
