import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const [dbPrepare, shopFragment, redCosmosCss] = await Promise.all([
  fs.readFile(new URL('../scripts/red-cosmos-v2-db-prepare.mjs', import.meta.url), 'utf8'),
  fs.readFile(new URL('../scripts/fragments/red-cosmos-shop-client.fragment.txt', import.meta.url), 'utf8'),
  fs.readFile(new URL('../red-cosmos-v2.css', import.meta.url), 'utf8')
]);

test('permanent user_frames ownership restores legacy frame entitlements without charging twice', () => {
  assert.match(dbPrepare, /async function syncPermanentFrameOwnership/);
  assert.match(dbPrepare, /FROM user_frames uf/);
  assert.match(dbPrepare, /ON CONFLICT\(code,user_id\) DO NOTHING/);
  assert.match(dbPrepare, /profile-frame-beer-mugs/);
  assert.match(dbPrepare, /profile-frame-beer-bottles/);
  assert.match(dbPrepare, /profile-frame-lights/);
  assert.match(dbPrepare, /profile-frame-premium-smiling-fuck/);
});

test('owner money frame restoration uses exact configured Telegram and VK identities', () => {
  assert.match(dbPrepare, /OWNER_TELEGRAM_ID/);
  assert.match(dbPrepare, /OWNER_VK_ID/);
  assert.match(dbPrepare, /ui\.provider='telegram'/);
  assert.match(dbPrepare, /ui\.provider='vk'/);
  assert.match(dbPrepare, /'money','owner-identity-restore'/);
  assert.match(dbPrepare, /COALESCE\(NULLIF\(profile_frame,''\),'none'\)='none'/);
});

test('shop repairs all four visible frame artworks and renders a live frame preview', () => {
  for (const code of ['frame-beer-mugs', 'frame-beer-bottles', 'frame-lights', 'frame-premium-smiling-fuck']) {
    assert.match(dbPrepare, new RegExp(code));
  }
  assert.match(dbPrepare, /is_hidden=FALSE,is_purchasable=TRUE/);
  assert.match(shopFragment, /function shopFramePreviewMarkup/);
  assert.match(shopFragment, /avatarInlineHtml\(entity, 'shop-frame-preview-avatar'\)/);
  assert.match(shopFragment, /shopFramePreviewMarkup\(item\)/);
  assert.match(redCosmosCss, /\.shop-frame-live-preview/);
  assert.match(redCosmosCss, /\.shop-frame-preview-avatar/);
});

test('tester reconciliation remains exact and idempotent while accepting canonical username fallback', () => {
  assert.match(dbPrepare, /pivnik_claim_pending_special_achievement/);
  assert.match(dbPrepare, /COALESCE\(NULLIF\(ui\.provider_username,''\),NULLIF\(u\.username,''\)\)/);
  assert.match(dbPrepare, /drolted/);
  assert.match(dbPrepare, /distraktor/);
  assert.match(dbPrepare, /olesyaolese/);
  assert.match(dbPrepare, /drollted/);
  assert.match(dbPrepare, /ksemar/);
  assert.doesNotMatch(dbPrepare, /ILIKE/);
});
