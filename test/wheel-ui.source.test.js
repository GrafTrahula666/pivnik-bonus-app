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
    readFile(new URL('assets/spaceverse/lab-wheel-disc.webp', root))
  ]);
  assert.equal(image.subarray(8, 12).toString(), 'WEBP');
  assert.match(index, /<img class="wheel-disk" id="wheelDisk" src="\/assets\/spaceverse\/lab-wheel-disc\.webp"/);
  assert.match(styles, /\.wheel-screen \.wheel-disk\s*\{[\s\S]*?background: none;/);
  const sectors = [...app.matchAll(/\{ code: '([a-z0-9-]+)', center: (\d+) \}/g)]
    .map(([, code, center]) => [code, Number(center)]);
  assert.deepEqual(sectors, [
    ['annual-beer', 0], ['bonus-100', 24], ['beer-glass', 49], ['bonus-10', 72],
    ['bonus-20', 92], ['beer-glass', 116], ['bonus-5', 134], ['bonus-50', 156],
    ['beer-glass', 180], ['bonus-100', 202], ['bonus-10', 224], ['beer-glass', 246],
    ['bonus-20', 268], ['bonus-5', 288], ['beer-glass', 310], ['bonus-50', 336]
  ]);
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

test('Guest wheel rules and status do not publish internal prize chances', async () => {
  const [index, gateway, business] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('universal-server.js', root), 'utf8'),
    readFile(new URL('server.js', root), 'utf8')
  ]);
  const rules = index.slice(index.indexOf('id="wheelRulesModal"'), index.indexOf('id="qrModal"'));
  assert.match(rules, /0,5 л бесплатного пива/);
  assert.doesNotMatch(rules, /wheelOddsList|\d%|1 из 1 000 000/);
  assert.doesNotMatch(gateway, /wheelPrizeChances|chancePercent/);
  assert.match(business, /prizes: wheelPrizeChances\(\)/);
});
