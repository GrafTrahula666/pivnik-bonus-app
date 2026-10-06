import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const [server, gateway, shopFragment] = await Promise.all([
  fs.readFile(new URL('../server.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../universal-server.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../scripts/fragments/red-cosmos-shop-client.fragment.txt', import.meta.url), 'utf8')
]);

const ownerFrames = [
  'money','fire','diamond','beer-mugs','beer-bottles','lights','middle-finger',
  'premium-smiling-fuck','anna','olesya','vladislav','icecream69a'
];

test('owner can select every current frame while money remains the safe default', () => {
  for (const source of [server, gateway]) {
    assert.match(source, /PIVNIK_FRAME_SHOP_ROTATION_OWNER_ALL_20260909/);
    assert.match(source, /OWNER_FRAME_CODES\.has\(selectedFrame\) \? selectedFrame : 'money'/);
    assert.match(source, /if \(isOwnerRow\(row\)\) return OWNER_FRAME_CATALOG\.map/);
    for (const frameCode of ownerFrames) assert.match(source, new RegExp(`code: '${frameCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  }
  assert.doesNotMatch(server, /const storedFrame = isOwnerRow\(accessRow\) \|\|/);
  assert.doesNotMatch(gateway, /if \(isOwnerRow\(row\)\) storedFrame = 'money'/);
});

test('buying a frame still refreshes the profile without changing purchase accounting', () => {
  assert.match(shopFragment, /api\('\/api\/shop\/buy'/);
  assert.match(shopFragment, /if \(data\.profile\) state\.profile = data\.profile;/);
  assert.match(shopFragment, /renderProfile\(\);/);
  assert.match(shopFragment, /await loadCatalog\(\);/);
  assert.match(server, /INSERT INTO user_frames\(user_id,frame_id,acquired_source,purchase_transaction_id\)/);
});
