import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('home page keeps the approved SPACEVERSE → wheel → liters → league order', async () => {
  const index = await readFile(new URL('index.html', root), 'utf8');
  const hero = index.indexOf('class="hero-card vip-hero-card spaceverse-home-hero"');
  const spaceverse = index.indexOf('id="openSpaceverseBusiness"');
  const wheel = index.indexOf('id="openWheelButton"');
  const beer = index.indexOf('id="beerLoyaltyCard"');
  const league = index.indexOf('id="openLeaderboardButton"');

  assert.ok(hero >= 0);
  assert.ok(hero < spaceverse);
  assert.ok(spaceverse < wheel);
  assert.ok(wheel < beer);
  assert.ok(beer < league);
  assert.match(index, /У вас свой бизнес\?/);
  assert.match(index, /Подключим приложение бесплатно за 1 день/);
  assert.match(index, /id="homeLeaderboardPreview"/);
  assert.match(index, /id="openShopButton"/);
  assert.match(index, /id="openPromosButton"/);
});

test('Approved image is the spinning disk and reward stops match its pictured labels', async () => {
  const [app, styles, index, image] = await Promise.all([
    readFile(new URL('app.js', root), 'utf8'),
    readFile(new URL('styles.css', root), 'utf8'),
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('assets/home-v2/wheel-approved-20260929.png', root))
  ]);
  assert.equal(image.subarray(1, 4).toString(), 'PNG');
  assert.match(index, /<img class="wheel-disk" id="wheelDisk" src="\/assets\/home-v2\/wheel-approved-20260929\.png"/);
  assert.match(styles, /\.wheel-screen \.wheel-disk\s*\{[\s\S]*?background: none;/);
  assert.match(app, /'annual-beer', 'beer-glass', 'bonus-100', 'bonus-5'/);
  assert.match(app, /'bonus-5', null,/);
  assert.match(app, /\.filter\(\(sector\) => sector\.code\)/);
  assert.match(app, /visualSectorForPrize\(data\.spin\?\.prize\?\.code\)/);
});

test('Wheel screen keeps functional controls and a personal history', async () => {
  const [index, styles, gateway] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('styles.css', root), 'utf8'),
    readFile(new URL('universal-server.js', root), 'utf8')
  ]);

  assert.match(index, /id="wheelAvailability">Бесплатное вращение доступно/);
  assert.match(index, /id="wheelSpinButton"[^>]*>Крутить бесплатно</);
  assert.match(index, /id="wheelNextFreeHint">Следующее бесплатное вращение — через 24 часа после этого\./);
  assert.match(index, /id="wheelHistory"/);
  assert.match(styles, /\.wheel-history-row\s*\{/);
  assert.match(index, /id="openWheelRulesButton"[^>]*><span>Документы<\/span>/);
  assert.match(styles, /\.app-shell\.wheel-mode \.bottom-nav\s*\{\s*display:\s*none;/);
  assert.match(styles, /\.wheel-screen \.wheel-emblem \{ display: none !important; \}/);
  assert.match(gateway, /WHERE user_id = \$1::bigint\s+ORDER BY created_at DESC, id DESC\s+LIMIT 20/);
  assert.match(gateway, /url\.pathname === '\/api\/wheel\/history'[\s\S]*?requireGatewayUser\(req\)[\s\S]*?getWheelHistory\(user\.id\)/);
});
