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

test('RED COSMOS shell hard-removes obsolete v22 UI assets after legacy code patches', async () => {
  const shell = await read('scripts/apply-red-cosmos-v2-shell-final.mjs');
  assert.match(shell, /v22\\\.css/);
  assert.match(shell, /v22-ui\\\.js/);
  assert.match(shell, /red-cosmos-v2\.css\?v=2\.0\.0/);
  assert.match(shell, /red-cosmos-v2\.js\?v=2\.0\.0/);
  assert.match(shell, /RED_COSMOS_V2_THEME_LOCK/);
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
  const client = await read('scripts/apply-red-cosmos-v2-client-final.mjs');
  for (const name of ['renderWheelStatus', 'startWheelCountdown', 'loadWheelStatus', 'spinWheel', 'openWheel']) {
    assert.match(client, new RegExp(name));
  }
  assert.match(client, /premium-smiling-fuck/);
  assert.match(client, /\/api\/shop\/buy/);
  assert.match(client, /Рамка куплена и сохранена в профиле/);
});

test('RED COSMOS UI reserves visible layout space for back controls and modal stacking', async () => {
  const css = await read('red-cosmos-v2.css');
  assert.match(css, /\.v2-back-button/);
  assert.match(css, /position:\s*static\s*!important/);
  assert.match(css, /min-height:\s*46px/);
  assert.match(css, /\.modal\.open/);
  assert.match(css, /z-index:\s*10000/);
  assert.match(css, /\.bottom-nav/);
  assert.match(css, /grid-template-columns:\s*repeat\(5/);
});
