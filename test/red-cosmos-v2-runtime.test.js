import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const read = (file) => fs.readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('RED COSMOS final scripts are wired into materialize and prestart in a deterministic order', async () => {
  const pkg = JSON.parse(await read('package.json'));
  for (const name of [
    'apply-red-cosmos-v2-shell-final.mjs',
    'apply-red-cosmos-v2-backend-final.mjs',
    'apply-red-cosmos-v2-client-final.mjs'
  ]) {
    assert.match(pkg.scripts.materialize, new RegExp(name.replaceAll('.', '\\.')));
    assert.match(pkg.scripts.prestart, new RegExp(name.replaceAll('.', '\\.')));
    assert.match(pkg.scripts.check, new RegExp(name.replaceAll('.', '\\.')));
  }
  assert.match(pkg.scripts.prestart, /red-cosmos-v2-db-prepare\.mjs/);
  assert.doesNotMatch(pkg.scripts.materialize, /red-cosmos-v2-db-prepare\.mjs/);
});

test('startup shell retires legacy visual layers and preserves only the interaction fallback', async () => {
  const shell = await read('scripts/apply-red-cosmos-v2-shell-final.mjs');
  assert.match(shell, /CANONICAL_STYLE_VERSION = '20\.9-service-entry-canonical-profile-placement-20260925'/);
  assert.match(shell, /forbiddenVisualAssets/);
  assert.match(shell, /\/red-cosmos-v2\.css/);
  assert.match(shell, /\/black-frosted-glass\.css/);
  assert.match(shell, /\/red-cosmos-v2\.js\?v=2\.0\.1/);
  assert.match(shell, /SPACEVERSE_CANONICAL_THEME_LOCK/);
});

test('RED COSMOS backend implements idempotent direct frame purchases', async () => {
  const backend = await read('scripts/apply-red-cosmos-v2-backend-final.mjs');
  assert.match(backend, /self-shop:/);
  assert.match(backend, /pg_advisory_xact_lock/);
  assert.match(backend, /shop_purchases/);
  assert.match(backend, /ON CONFLICT\(user_id,frame_id\) DO NOTHING/);
  assert.match(backend, /✓ Куплено/);
  assert.match(backend, /UPDATE wallets SET balance=/);
  assert.match(backend, /mode,status,bonus_spent,balance_after/);
});

test('RED COSMOS client removes all VK-only wheel guards and renders premium frame', async () => {
  const [client, fragment] = await Promise.all([
    read('scripts/apply-red-cosmos-v2-client-final.mjs'),
    read('scripts/fragments/red-cosmos-shop-client.fragment.txt')
  ]);
  for (const name of ['renderWheelStatus', 'startWheelCountdown', 'loadWheelStatus', 'spinWheel', 'openWheel']) {
    assert.match(client, new RegExp(name));
  }
  assert.match(client, /premium-smiling-fuck/);
  assert.match(fragment, /\/api\/shop\/buy/);
  assert.match(fragment, /Рамка куплена и сохранена в профиле/);
});

test('canonical back controls are compact, in-flow and shared by screens and modals', async () => {
  const [css, ui] = await Promise.all([read('styles.css'), read('red-cosmos-v2.js')]);
  assert.match(css, /PIVNIK_UNIFIED_BACK_CONTROLS_20260926/);
  assert.match(css, /\.pivnik-back-button/);
  assert.match(css, /position:\s*static\s*!important/);
  assert.match(css, /width:\s*40px\s*!important/);
  assert.match(css, /height:\s*40px\s*!important/);
  assert.match(css, /box-shadow:\s*none\s*!important/);
  assert.match(css, /\.pivnik-back-button\.hidden/);
  assert.match(ui, /\.modal-sheet > \.close/);
  assert.match(ui, /spaceverseBusinessBack/);
  assert.match(ui, /button\.classList\.add\('pivnik-back-button'\)/);
  assert.match(ui, /button\.textContent = '←'/);
});
