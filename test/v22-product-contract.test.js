import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

async function text(file) {
  return fs.readFile(new URL(`../${file}`, import.meta.url), 'utf8');
}

test('v22 red cosmos assets are wired after the legacy client', async () => {
  const [index, css, ui] = await Promise.all([text('index.html'), text('v22.css'), text('v22-ui.js')]);
  assert.match(index, /\/v22\.css\?v=22\.0\.0/);
  assert.match(index, /\/v22-ui\.js\?v=22\.0\.0/);
  assert.match(css, /PIVNIK v22 — red cosmos/);
  assert.match(css, /\.achievement-tile\.locked/);
  assert.match(css, /\.v22-admin-tabs/);
  assert.match(ui, /← Назад/);
  assert.match(ui, /platform-vk/);
});

test('v22 shop contains only the requested default catalog and permanent frame entitlements', async () => {
  const server = await text('server.js');
  for (const code of [
    'custom-mug-design',
    'frame-beer-mugs',
    'frame-beer-bottles',
    'frame-lights',
    'frame-middle-finger'
  ]) assert.match(server, new RegExp(code));
  assert.match(server, /v22-shop-catalog-reset-20260827/);
  assert.match(server, /Эта рамка уже куплена и навсегда доступна/);
  assert.match(server, /profile-frame-middle-finger/);
});

test('v22 keeps 18 deterministic countable achievements and exposes tester award separately', async () => {
  const [achievements, server, gateway] = await Promise.all([
    text('achievements.js'), text('server.js'), text('universal-server.js')
  ]);
  assert.doesNotMatch(achievements, /code: 'raise-shields'/);
  assert.match(achievements, /label: 'Получено'/);
  assert.match(server, /code: 'raise-shields'/);
  assert.match(server, /rewardBonus: 750/);
  assert.match(server, /achievement_code = 'raise-shields'/);
  assert.match(gateway, /code: 'raise-shields'/);
  assert.match(gateway, /achievement_code = 'raise-shields'/);
});

test('v22 enables one wheel backend for VK and Telegram', async () => {
  const [gateway, index, app] = await Promise.all([text('universal-server.js'), text('index.html'), text('app.js')]);
  assert.doesNotMatch(gateway, /Колесо доступно только в Telegram/);
  assert.match(gateway, /spinTelegramWheel\(user\.id, body\.requestKey, platform\)/);
  assert.match(gateway, /platform === 'vk' \? 'vk' : 'telegram'/);
  assert.match(index, /id="openWheelButton"/);
  assert.match(index, /id="wheelSpinButton"/);
  assert.doesNotMatch(app, /if \(!IS_VK\) jobs\.push\(loadWheelStatus\(\)\)/);
});

test('v22 leaderboard exposes platform labels and screen navigation has real history', async () => {
  const [gateway, app] = await Promise.all([text('universal-server.js'), text('app.js')]);
  assert.match(gateway, /platformLabel/);
  assert.match(gateway, /VK · Telegram/);
  assert.match(app, /leader\.platformLabel/);
  assert.match(app, /window\.__PIVNIK_GO_BACK__/);
  assert.match(app, /state\.screenHistory/);
});

test('v22 production data repair remains dry-run unless explicit confirmation is present', async () => {
  const audit = await text('scripts/v22-data-audit-and-repair.mjs');
  assert.match(audit, /PIVNIK_V22_REPAIR_CONFIRM/);
  assert.match(audit, /REPAIR_PIVNIK_V22_20260827/);
  assert.match(audit, /Dry-run only\. No production data was changed\./);
  assert.match(audit, /drolted/);
  assert.match(audit, /distraktor/);
  assert.match(audit, /ksemar/);
});
