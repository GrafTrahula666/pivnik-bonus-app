import assert from 'node:assert/strict';
import test from 'node:test';

process.env.PIVNIK_TEST_IMPORT = '1';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/test';
process.env.SESSION_SECRET = 'render-test-session-secret-only';

test('Gateway render: / and /vk load the correct platform scripts and loader fix', async () => {
  const {
    buildReferralShareUrl,
    documentSecurityHeaders,
    platformForDocumentRequest,
    renderAppIndex
  } = await import('../universal-server.js?render-test');
  const telegram = await renderAppIndex('telegram');
  const vk = await renderAppIndex('vk');
  const vkCsp = documentSecurityHeaders('vk')['content-security-policy'];

  assert.match(telegram, /https:\/\/telegram\.org\/js\/telegram-web-app\.js/);
  assert.match(telegram, /\/account-link\.js/);
  assert.match(telegram, /\/loader-fix\.css/);
  assert.doesNotMatch(telegram, /\/vk-platform\.js/);
  assert.match(telegram, /id="openWheelButton"/);
  assert.match(telegram, /data-screen="wheel"/);
  assert.match(telegram, /id="wheelRulesModal"/);
  assert.doesNotMatch(telegram, /id="openShopButton"/);
  assert.doesNotMatch(telegram, /id="openPromosButton"/);

  assert.doesNotMatch(vk, /https:\/\/telegram\.org\/js\/telegram-web-app\.js/);
  assert.match(vk, /\/vendor\/vk-bridge\.js\?v=2\.15\.11/);
  assert.match(vk, /\/vk-platform\.js\?v=3\.3\.0-direct-entry/);
  assert.match(vk, /\/account-link\.js/);
  assert.match(vk, /\/loader-fix\.css/);
  assert.doesNotMatch(vk, /id="openWheelButton"/);
  assert.doesNotMatch(vk, /data-screen="wheel"/);
  assert.doesNotMatch(vk, /id="wheelRulesModal"/);
  assert.match(vk, /id="openShopButton"/);
  assert.match(vk, /id="openPromosButton"/);

  const bridgePosition = vk.indexOf('/vendor/vk-bridge.js');
  const platformPosition = vk.indexOf('/vk-platform.js');
  const linkingPosition = vk.indexOf('/account-link.js');
  const appScript = vk.match(/app\.js\?v=[^"']+/)?.[0] || '';
  const appPosition = appScript ? vk.indexOf(appScript) : -1;
  assert.ok(bridgePosition >= 0);
  assert.ok(platformPosition >= 0);
  assert.ok(linkingPosition >= 0);
  assert.ok(appPosition >= 0);
  assert.ok(bridgePosition < platformPosition);
  assert.ok(platformPosition < linkingPosition);
  assert.ok(linkingPosition < appPosition);

  assert.match(vkCsp, /frame-ancestors [^;]*https:\/\/vk\.com/);
  assert.match(vkCsp, /frame-ancestors [^;]*https:\/\/\*\.vk\.com/);
  assert.match(vkCsp, /frame-ancestors [^;]*https:\/\/vk\.ru/);
  assert.match(vkCsp, /frame-ancestors [^;]*https:\/\/\*\.vk\.ru/);

  assert.equal(
    platformForDocumentRequest(new URL('https://pivnik.example/')),
    'telegram'
  );
  assert.equal(
    platformForDocumentRequest(new URL('https://pivnik.example/vk')),
    'vk'
  );
  assert.equal(
    platformForDocumentRequest(
      new URL('https://pivnik.example/?vk_app_id=54694987&vk_user_id=123&sign=test')
    ),
    'vk'
  );
  assert.equal(
    platformForDocumentRequest(
      new URL('https://pivnik.example/index.html?vk_user_id=123&vk_platform=desktop_web&sign=test')
    ),
    'vk'
  );
  assert.equal(
    platformForDocumentRequest(
      new URL('https://pivnik.example/'),
      { referer: 'https://vk.ru/app54694987' }
    ),
    'vk'
  );
  assert.equal(
    platformForDocumentRequest(
      new URL('https://pivnik.example/'),
      { origin: 'https://api.vk.com' }
    ),
    'vk'
  );
  assert.equal(
    platformForDocumentRequest(
      new URL('https://pivnik.example/'),
      { 'user-agent': 'Mozilla/5.0 VK-iPhone/8.120' }
    ),
    'vk'
  );
  assert.equal(
    platformForDocumentRequest(
      new URL('https://pivnik.example/'),
      { referer: 'https://not-vk.example/app54694987' }
    ),
    'telegram'
  );
  assert.equal(
    platformForDocumentRequest(
      new URL('https://pivnik.example/'),
      {},
      'vk'
    ),
    'vk'
  );

  assert.equal(
    buildReferralShareUrl('telegram', 'pvk-abcde234', '@PivnikBonusBot'),
    'https://t.me/PivnikBonusBot?startapp=PVK-ABCDE234'
  );
  assert.equal(
    buildReferralShareUrl('vk', 'PVK-ABCDE234'),
    'https://vk.com/app54694987#ref=PVK-ABCDE234'
  );
  assert.equal(buildReferralShareUrl('telegram', 'not-a-code', 'PivnikBonusBot'), '');
});

test('VK Railway service serves VK document from the bare root URL', async () => {
  const previous = process.env.PIVNIK_DOCUMENT_PLATFORM;
  process.env.PIVNIK_DOCUMENT_PLATFORM = 'vk';
  try {
    const {
      platformForDocumentRequest,
      renderAppIndex
    } = await import('../universal-server.js?render-vk-default');
    const platform = platformForDocumentRequest(new URL('https://pivnik.example/'));
    const html = await renderAppIndex(platform);

    assert.equal(platform, 'vk');
    assert.match(html, /\/vendor\/vk-bridge\.js\?v=2\.15\.11/);
    assert.match(html, /\/vk-platform\.js\?v=3\.3\.0-direct-entry/);
    assert.doesNotMatch(html, /https:\/\/telegram\.org\/js\/telegram-web-app\.js/);
  } finally {
    if (previous === undefined) delete process.env.PIVNIK_DOCUMENT_PLATFORM;
    else process.env.PIVNIK_DOCUMENT_PLATFORM = previous;
  }
});
