import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const read = (path) => fs.readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const EXPECTED_SHOP_CODES = [
  'frame-beer-mugs',
  'frame-beer-bottles',
  'frame-lights',
  'frame-premium-smiling-fuck'
];

test('RED COSMOS palette is locked and platform-neutral', async () => {
  const [css, index, app] = await Promise.all([
    read('red-cosmos-v2.css'),
    read('index.html'),
    read('app.js')
  ]);
  assert.match(css, /--primary-red:\s*#c41e3a/i);
  assert.match(css, /--cosmic-purple:\s*#4a0d3a/i);
  assert.match(css, /--cosmic-dark:\s*#0d0002/i);
  assert.match(css, /\.platform-vk[\s\S]*\.platform-telegram/);
  assert.match(index, /red-cosmos-v2\.css\?v=2\.0\.0/);
  assert.match(index, /red-cosmos-v2\.js\?v=2\.0\.0/);
  assert.match(app, /RED_COSMOS_V2_THEME_LOCK/);
});

test('VK and Telegram use the same wheel markup and backend routes', async () => {
  const [gateway, app, migration] = await Promise.all([
    read('universal-server.js'),
    read('app.js'),
    read('migrations/007_red_cosmos_v2.sql')
  ]);
  assert.doesNotMatch(gateway, /Колесо доступно только в Telegram/);
  assert.doesNotMatch(gateway, /telegram-wheel:start[\s\S]*?replace[\s\S]*?''/);
  assert.match(gateway, /getTelegramWheelStatus\(user\.id, pool, null, platform\)/);
  assert.match(gateway, /spinTelegramWheel\(user\.id, body\.requestKey, platform\)/);
  assert.match(migration, /CHECK \(platform IN \('telegram', 'vk'\)\)/);
  assert.doesNotMatch(app, /function openWheel\(\) \{\s*if \(IS_VK\) return;/);
  assert.doesNotMatch(app, /async function spinWheel\(\) \{\s*if \(IS_VK/);
});

test('client shop exposes exactly four new purchasable frame products', async () => {
  const [server, app] = await Promise.all([read('server.js'), read('app.js')]);
  for (const code of EXPECTED_SHOP_CODES) {
    assert.match(server, new RegExp(`code: '${code}'`));
    assert.match(app, new RegExp(`'${code}'`));
  }
  assert.doesNotMatch(server, /\{ code: 'custom-mug-design'/);
  assert.match(server, /WHERE active=TRUE AND is_hidden=FALSE/);
  assert.match(server, /app\.post\('\/api\/shop\/buy'/);
  assert.match(server, /shop_purchases/);
  assert.match(server, /user_frames/);
  assert.match(app, /data-shop-buy/);
  assert.match(app, /✓ Куплено/);
});

test('frame ownership is permanent in both child server and gateway', async () => {
  const [server, gateway, migration] = await Promise.all([
    read('server.js'),
    read('universal-server.js'),
    read('migrations/007_red_cosmos_v2.sql')
  ]);
  for (const code of ['beer-mugs', 'beer-bottles', 'lights', 'premium-smiling-fuck']) {
    assert.match(server, new RegExp(code));
    assert.match(gateway, new RegExp(code));
  }
  assert.match(server, /AS owned_frames/);
  assert.match(gateway, /AS owned_frames/);
  assert.match(gateway, /FROM user_frames uf WHERE uf\.user_id = u\.id/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS user_frames/);
  assert.match(migration, /UNIQUE \(user_id, frame_id\)/);
});

test('achievement state is server-authoritative and earned cards say Получено', async () => {
  const [achievements, server, css] = await Promise.all([
    read('achievements.js'),
    read('server.js'),
    read('red-cosmos-v2.css')
  ]);
  assert.match(achievements, /user_achievements_v2/);
  assert.match(achievements, /label: 'Получено'/);
  assert.match(server, /\/api\/admin\/achievements-v2/);
  assert.match(css, /achievement-tile\.locked/);
  assert.match(css, /achievement-tile\.earned/);
});

test('VK QR UI contains no legacy permanent or reusable copy', async () => {
  const [app, enhancer] = await Promise.all([read('app.js'), read('red-cosmos-v2.js')]);
  assert.doesNotMatch(app, /Код постоянный|QR постоянный|многоразов/i);
  assert.match(enhancer, /cleanVkQrCopy/);
});

test('admin navigation has exactly eight RED COSMOS sections', async () => {
  const enhancer = await read('red-cosmos-v2.js');
  const labels = ['Главная', 'Пользователи', 'Операции', 'Смена', 'Достижения', 'Магазин', 'Рамки', 'Настройки'];
  for (const label of labels) assert.match(enhancer, new RegExp(`'${label}'`));
  const definitions = enhancer.match(/\['(?:dashboard|users|operations|shift|achievements|shop|frames|settings)',\s*'[^']+'\]/g) || [];
  assert.equal(definitions.length, 8);
});
