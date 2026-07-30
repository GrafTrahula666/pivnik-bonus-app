import assert from 'node:assert/strict';
import test from 'node:test';

process.env.PIVNIK_TEST_IMPORT = '1';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/test';
process.env.SESSION_SECRET = 'render-test-session-secret-only';

test('Gateway render: / and /vk load the correct platform scripts and loader fix', async () => {
  const { renderAppIndex } = await import('../universal-server.js?render-test');
  const telegram = await renderAppIndex('telegram');
  const vk = await renderAppIndex('vk');

  assert.match(telegram, /https:\/\/telegram\.org\/js\/telegram-web-app\.js/);
  assert.match(telegram, /\/account-link\.js/);
  assert.match(telegram, /\/loader-fix\.css/);
  assert.doesNotMatch(telegram, /\/vk-platform\.js/);

  assert.doesNotMatch(vk, /https:\/\/telegram\.org\/js\/telegram-web-app\.js/);
  assert.match(vk, /\/vendor\/vk-bridge\.js\?v=2\.15\.11/);
  assert.match(vk, /\/vk-platform\.js/);
  assert.match(vk, /\/account-link\.js/);
  assert.match(vk, /\/loader-fix\.css/);

  const bridgePosition = vk.indexOf('/vendor/vk-bridge.js');
  const platformPosition = vk.indexOf('/vk-platform.js');
  const linkingPosition = vk.indexOf('/account-link.js');
  const appPosition = vk.indexOf('app.js?v=16.0-premium-achievements');
  assert.ok(bridgePosition < platformPosition);
  assert.ok(platformPosition < linkingPosition);
  assert.ok(linkingPosition < appPosition);
});
