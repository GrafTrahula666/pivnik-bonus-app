import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

async function text(file) {
  return fs.readFile(new URL(`../${file}`, import.meta.url), 'utf8');
}

test('RED COSMOS final shell replaces the obsolete v22 visual layer', async () => {
  const [index, css, ui] = await Promise.all([
    text('index.html'),
    text('red-cosmos-v2.css'),
    text('red-cosmos-v2.js')
  ]);
  assert.match(index, /\/red-cosmos-v2\.css\?v=2\.0\.0/);
  assert.match(index, /\/red-cosmos-v2\.js\?v=2\.0\.0/);
  assert.doesNotMatch(index, /\/v22\.css/);
  assert.doesNotMatch(index, /\/v22-ui\.js/);
  assert.match(css, /--primary-red:\s*#c41e3a/);
  assert.match(css, /\.achievement-tile\.locked/);
  assert.match(css, /\.achievement-tile\.earned/);
  assert.match(css, /\.red-cosmos-admin-tabs/);
  assert.match(ui, /← Назад/);
  assert.match(ui, /installVkInteractionFallback/);
});

test('RED COSMOS client shop is exactly four permanent frame products with artwork', async () => {
  const [server, client, css] = await Promise.all([
    text('server.js'), text('app.js'), text('red-cosmos-v2.css')
  ]);
  const codes = [
    'frame-beer-mugs',
    'frame-beer-bottles',
    'frame-lights',
    'frame-premium-smiling-fuck'
  ];
  for (const code of codes) assert.match(server, new RegExp(`code: '${code}'`));
  assert.doesNotMatch(server, /code: 'custom-mug-design'/);
  assert.match(server, /WHERE active=TRUE AND code IN \('frame-beer-mugs','frame-beer-bottles','frame-lights','frame-premium-smiling-fuck'\)/);
  assert.match(server, /app\.post\('\/api\/shop\/buy'/);
  assert.match(server, /shop_purchases/);
  assert.match(server, /profile-frame-premium-smiling-fuck/);
  assert.match(client, /RED_COSMOS_SHOP_FRAMES/);
  assert.match(client, /✓ Куплено/);
  assert.match(client, /data-shop-buy/);
  assert.match(css, /avatar-frame-premium-smiling-fuck/);
  for (const asset of [
    'assets/shop/frame-beer-mugs.svg',
    'assets/shop/frame-beer-bottles.svg',
    'assets/shop/frame-lights.svg',
    'assets/shop/frame-premium-smiling-fuck.svg'
  ]) {
    const body = await text(asset);
    assert.match(body, /<svg/);
  }
});

test('achievements remain deterministic and the tester award stays outside the countable catalog', async () => {
  const [achievements, server, gateway, css] = await Promise.all([
    text('achievements.js'), text('server.js'), text('universal-server.js'), text('red-cosmos-v2.css')
  ]);
  assert.doesNotMatch(achievements, /code: 'raise-shields'/);
  assert.match(achievements, /Math\.min\(normalizedCurrent, target\)/);
  assert.match(achievements, /percent:\s*Math\.min\(100/);
  assert.match(server, /code: 'raise-shields'/);
  assert.match(server, /rewardBonus:\s*750/);
  assert.match(server, /achievement_code = 'raise-shields'/);
  assert.match(gateway, /code: 'raise-shields'/);
  assert.match(gateway, /achievement_code = 'raise-shields'/);
  assert.match(css, /\.achievement-tile\.locked/);
  assert.match(css, /\.achievement-tile\.earned/);
});

test('one wheel backend is enabled for VK and Telegram', async () => {
  const [gateway, index, app] = await Promise.all([
    text('universal-server.js'), text('index.html'), text('app.js')
  ]);
  assert.doesNotMatch(gateway, /Колесо доступно только в Telegram/);
  assert.match(gateway, /spinTelegramWheel\(user\.id, body\.requestKey, platform\)/);
  assert.match(gateway, /platform === 'vk' \? 'vk' : 'telegram'/);
  assert.match(index, /id="openWheelButton"/);
  assert.match(index, /id="wheelSpinButton"/);
  assert.doesNotMatch(app, /function openWheel\(\) \{\n\s*if \(IS_VK\) return;/);
  assert.doesNotMatch(app, /if \(!IS_VK\) jobs\.push\(loadWheelStatus\(\)\)/);
});

test('league exposes platform labels and VK interaction fallback covers core controls', async () => {
  const [gateway, app, ui] = await Promise.all([
    text('universal-server.js'), text('app.js'), text('red-cosmos-v2.js')
  ]);
  assert.match(gateway, /platformLabel/);
  assert.match(gateway, /VK · Telegram/);
  assert.match(app, /leader\.platformLabel/);
  for (const token of ['navQrButton', 'openShopButton', 'openWheelButton', 'openAchievementsButton']) {
    assert.match(ui, new RegExp(token));
  }
  assert.match(ui, /\.bottom-nav \[data-target\]/);
  assert.match(ui, /forceOpenModal/);
  assert.match(ui, /forceScreen/);
});

test('RED COSMOS database migration is additive and protects permanent ownership', async () => {
  const [migration, prepare] = await Promise.all([
    text('migrations/007_red_cosmos_v2.sql'),
    text('scripts/red-cosmos-v2-db-prepare.mjs')
  ]);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS user_achievements_v2/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS user_frames/);
  assert.match(migration, /UNIQUE \(user_id, frame_id\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS shop_purchases/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS special_achievement_grants/);
  assert.match(migration, /CHECK \(platform IN \('telegram', 'vk'\)\)/);
  assert.doesNotMatch(migration, /DROP TABLE/i);
  assert.doesNotMatch(migration, /DELETE FROM users/i);
  assert.match(prepare, /pivnik_red_cosmos_v2_preupgrade_20260827/);
  assert.match(prepare, /CREATE TABLE .* AS TABLE public/);
  assert.match(prepare, /RED COSMOS DB backup verification failed/);
});
