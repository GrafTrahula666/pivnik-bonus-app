import assert from 'node:assert/strict';
import test from 'node:test';

process.env.PIVNIK_TEST_IMPORT = '1';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/test';
process.env.SESSION_SECRET = 'render-test-session-secret-only';

test('Gateway render: /, /vk and /vk/ load root-absolute platform assets', async () => {
  const {
    documentSecurityHeaders,
    platformForDocumentRequest,
    renderAppIndex
  } = await import('../universal-server.js?render-test');
  const telegram = await renderAppIndex('telegram');
  const vkNonce = 'gateway-render-nonce';
  const vk = await renderAppIndex('vk', vkNonce);
  const vkCsp = documentSecurityHeaders('vk', vkNonce)['content-security-policy'];

  assert.match(telegram, /https:\/\/telegram\.org\/js\/telegram-web-app\.js/);
  assert.match(telegram, /\/account-link\.js\?v=2\.3\.0/);
  assert.match(telegram, /\/loader-fix\.css/);
  assert.match(telegram, /href="\/styles\.css\?v=16\.0-premium-achievements"/);
  assert.match(telegram, /src="\/app\.js\?v=16\.6-optional-profile"/);
  assert.doesNotMatch(telegram, /\/vk-platform\.js/);
  const telegramLinkingPosition = telegram.indexOf('/account-link.js');
  const telegramAppPosition = telegram.indexOf('/app.js?v=16.6-optional-profile');
  assert.ok(telegramLinkingPosition >= 0);
  assert.ok(telegramLinkingPosition < telegramAppPosition);

  assert.doesNotMatch(vk, /https:\/\/telegram\.org\/js\/telegram-web-app\.js/);
  assert.match(vk, new RegExp(`<script nonce="${vkNonce}">`));
  assert.match(vk, /window\.vkBridge=window\.vkConnect=/);
  assert.match(vk, /__PIVNIK_EARLY_VK_INIT_PROMISE__ = window\.vkBridge\.send\('VKWebAppInit'\)/);
  assert.doesNotMatch(vk, /src="\/vendor\/vk-bridge\.js/);
  assert.match(vk, /\/vk-platform\.js\?v=3\.3\.0/);
  assert.match(vk, /\/account-link\.js\?v=2\.3\.0/);
  assert.match(vk, /\/loader-fix\.css/);
  assert.match(vk, /href="\/styles\.css\?v=16\.0-premium-achievements"/);
  assert.match(vk, /src="\/app\.js\?v=16\.6-optional-profile"/);

  const resourceUrls = [...vk.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((resource) => resource.startsWith('/'));
  for (const basePath of ['/vk', '/vk/']) {
    const baseUrl = new URL(basePath, 'https://pivnik.example');
    for (const resource of resourceUrls) {
      const resolved = new URL(resource, baseUrl);
      assert.equal(
        resolved.pathname.startsWith('/vk/'),
        false,
        `${resource} must not resolve below ${basePath}`
      );
    }
  }

  const bridgePosition = vk.indexOf('__PIVNIK_EARLY_VK_INIT_PROMISE__');
  const platformPosition = vk.indexOf('/vk-platform.js');
  const linkingPosition = vk.indexOf('/account-link.js');
  const appPosition = vk.indexOf('/app.js?v=16.6-optional-profile');
  assert.ok(bridgePosition < platformPosition);
  assert.ok(platformPosition < linkingPosition);
  assert.ok(linkingPosition < appPosition);
  assert.match(vkCsp, new RegExp(`script-src [^;]*'nonce-${vkNonce}'`));

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
    platformForDocumentRequest(new URL('https://pivnik.example/vk/')),
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
});

test('Optional VK document override remains available without forcing Railway into VK mode', async () => {
  const previous = process.env.PIVNIK_DOCUMENT_PLATFORM;
  process.env.PIVNIK_DOCUMENT_PLATFORM = 'vk';
  try {
    const {
      platformForDocumentRequest,
      renderAppIndex
    } = await import('../universal-server.js?render-vk-default');
    const platform = platformForDocumentRequest(new URL('https://pivnik.example/'));
    const html = await renderAppIndex(platform, 'railway-render-nonce');

    assert.equal(platform, 'vk');
    assert.match(html, /window\.vkBridge=window\.vkConnect=/);
    assert.match(html, /__PIVNIK_EARLY_VK_INIT_PROMISE__/);
    assert.match(html, /\/vk-platform\.js\?v=3\.3\.0/);
    assert.match(html, /src="\/app\.js\?v=16\.6-optional-profile"/);
    assert.doesNotMatch(html, /https:\/\/telegram\.org\/js\/telegram-web-app\.js/);
  } finally {
    if (previous === undefined) delete process.env.PIVNIK_DOCUMENT_PLATFORM;
    else process.env.PIVNIK_DOCUMENT_PLATFORM = previous;
  }
});
