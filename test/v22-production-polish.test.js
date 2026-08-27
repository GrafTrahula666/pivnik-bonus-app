import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

async function text(file) {
  return fs.readFile(new URL(`../${file}`, import.meta.url), 'utf8');
}

test('v22 runtime wrapper skips already materialized product patches on process restart', async () => {
  const runtime = await text('scripts/apply-v22-runtime.mjs');
  assert.match(runtime, /productApplied/);
  assert.match(runtime, /restart-safe skip/);
  assert.match(runtime, /PIVNIK_V22_PRODUCT_REBUILD_20260827/);
  assert.match(runtime, /PIVNIK_V22_SPECIAL_ACHIEVEMENT_20260827/);
});

test('platform re-authentication cannot erase an existing platform photo with a partial payload', async () => {
  const gateway = await text('universal-server.js');
  assert.match(gateway, /photo_url = COALESCE\(\$5, photo_url\)/);
  assert.match(gateway, /profile_url = COALESCE\(EXCLUDED\.profile_url, user_identities\.profile_url\)/);
  assert.match(gateway, /provider_username = COALESCE\(EXCLUDED\.provider_username, user_identities\.provider_username\)/);
});

test('VK QR copy no longer claims that the user QR is permanent', async () => {
  const ui = await text('v22-ui.js');
  assert.match(ui, /Покажите QR сотруднику «Пивника» для начисления или списания/);
  assert.match(ui, /qr\\s\+постоян/i);
  assert.match(ui, /QR является постоянным/);
  assert.match(ui, /Показывайте свой QR сотруднику «Пивника»/);
});

test('v22 UI mutation observer schedules idempotent upgrades instead of rewriting the same nodes forever', async () => {
  const ui = await text('v22-ui.js');
  assert.match(ui, /dataset\.v22BackReady/);
  assert.match(ui, /dataset\.v22HistoryBackReady/);
  assert.match(ui, /let scheduled = false/);
  assert.match(ui, /new MutationObserver\(scheduleRun\)/);
});

test('production startup audit is read-only because repair confirmation is explicitly deleted', async () => {
  const gateway = await text('universal-server.js');
  assert.match(gateway, /delete process\.env\.PIVNIK_V22_REPAIR_CONFIRM/);
  assert.match(gateway, /v22-data-audit-and-repair\.mjs/);
  assert.match(gateway, /configuredDocumentPlatform === 'telegram'/);
});
