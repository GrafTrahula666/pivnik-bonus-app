import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (name) => fs.readFile(new URL(name, root), 'utf8');

test('SPACEVERSE business card opens a real lead page and submits through the existing inquiry backend', async () => {
  const [index, app, server, styles] = await Promise.all([
    read('index.html'),
    read('app.js'),
    read('server.js'),
    read('styles.css')
  ]);

  assert.match(index, /data-screen="spaceverse-business"/);
  assert.match(index, /id="spaceverseLeadName"/);
  assert.match(index, /id="spaceverseLeadPhone"/);
  assert.match(index, /id="spaceverseLeadSubmit"/);
  assert.match(index, /Информация о SPACEVERSE/);
  assert.match(index, /Содержимое страницы будет добавлено позже/);
  assert.match(index, /class="spaceverse-business-cta" id="openSpaceverseBusiness"/);

  assert.match(app, /function openSpaceverseBusinessPage\(\)/);
  assert.match(app, /async function submitSpaceverseBusinessLead\(\)/);
  assert.match(app, /itemCode: 'spaceverse-business-lead'/);
  assert.match(app, /api\('\/api\/shop\/inquiries'/);
  assert.match(app, /classList\.toggle\('spaceverse-business-mode'/);

  assert.match(server, /itemCode === 'spaceverse-business-lead'/);
  assert.match(server, /Новая заявка SPACEVERSE/);
  assert.match(styles, /SPACEVERSE BUSINESS LEAD PAGE/);
  assert.match(styles, /\.app-shell\.spaceverse-business-mode \.bottom-nav/);
});

test('profile platform label accepts provider payloads used by VK startup smokes', async () => {
  const app = await read('app.js');
  assert.match(app, /profile\.platform \|\| profile\.provider \|\| \(IS_VK \? 'vk' : 'telegram'\)/);
  assert.match(app, /profilePlatform === 'vk' \? 'VK Mini App' : 'Telegram Mini App'/);
});


test('canonical VK document keeps wheel markup instead of stripping Telegram-era markers', async () => {
  const [gateway, app] = await Promise.all([
    read('universal-server.js'),
    read('app.js')
  ]);
  assert.doesNotMatch(gateway, /telegram-wheel:start -->\[\\s\\S\]\*\?<!-- telegram-wheel:end/);
  assert.doesNotMatch(app, /function renderWheelStatus\(\) \{\n\s*if \(IS_VK\) return;/);
  assert.doesNotMatch(app, /function openWheel\(\) \{\n\s*if \(IS_VK\) return;/);
  assert.doesNotMatch(app, /async function spinWheel\(\) \{\n\s*if \(IS_VK \|\|/);
});
