import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

async function text(file) {
  return fs.readFile(new URL(`../${file}`, import.meta.url), 'utf8');
}

test('legacy v22 materialization remains restart-safe before RED COSMOS finalization', async () => {
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

test('VK QR copy no longer claims that the user QR is permanent or reusable', async () => {
  const [ui, app] = await Promise.all([text('red-cosmos-v2.js'), text('app.js')]);
  assert.match(ui, /Покажите QR сотруднику перед оплатой/);
  assert.match(ui, /QR является постоянным\|QR постоянный\|многораз/);
  assert.doesNotMatch(app, /Код постоянный и принадлежит только вам/);
  assert.doesNotMatch(app, /QR постоянный\. Не отправляйте его посторонним/);
});

test('RED COSMOS UI upgrades are idempotent and do not pile duplicate event handlers', async () => {
  const ui = await text('red-cosmos-v2.js');
  assert.match(ui, /dataset\.redCosmosBack/);
  assert.match(ui, /dataset\.redCosmosHistoryBound/);
  assert.match(ui, /window\.__RED_COSMOS_VK_INTERACTIONS__/);
  assert.match(ui, /let mutationScheduled = false/);
  assert.match(ui, /new MutationObserver\(scheduleEnhancements\)/);
});

test('RED COSMOS startup performs fail-closed database backup before migration', async () => {
  const [pkg, prepare] = await Promise.all([
    text('package.json'), text('scripts/red-cosmos-v2-db-prepare.mjs')
  ]);
  const prestart = JSON.parse(pkg).scripts.prestart;
  assert.match(prestart, /apply-red-cosmos-v2-shell-final\.mjs/);
  assert.match(prestart, /apply-red-cosmos-v2-backend-final\.mjs/);
  assert.match(prestart, /apply-red-cosmos-v2-client-final\.mjs/);
  assert.match(prestart, /red-cosmos-v2-db-prepare\.mjs/);
  assert.ok(prestart.indexOf('red-cosmos-v2-db-prepare.mjs') > prestart.indexOf('apply-red-cosmos-v2-client-final.mjs'));
  assert.match(prepare, /BEGIN/);
  assert.match(prepare, /createBackup\(client\)/);
  assert.match(prepare, /007_red_cosmos_v2\.sql/);
  assert.match(prepare, /ROLLBACK/);
});

test('production startup keeps legacy repair in read-only mode unless separately authorized', async () => {
  const gateway = await text('universal-server.js');
  assert.match(gateway, /delete process\.env\.PIVNIK_V22_REPAIR_CONFIRM/);
  assert.match(gateway, /v22-data-audit-and-repair\.mjs/);
});
