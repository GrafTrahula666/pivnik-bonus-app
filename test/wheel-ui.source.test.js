import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('Telegram wheel UI keeps the approved home-page order', async () => {
  const index = await readFile(new URL('index.html', root), 'utf8');
  const hero = index.indexOf('class="hero-card vip-hero-card"');
  const wheel = index.indexOf('id="openWheelButton"');
  const beer = index.indexOf('id="beerLoyaltyCard"');
  const stats = index.indexOf('class="home-stat-grid"');
  const achievements = index.indexOf('id="profileAchievementsSection"');

  assert.ok(hero >= 0);
  assert.ok(hero < wheel);
  assert.ok(wheel < beer);
  assert.ok(beer < stats);
  assert.ok(stats < achievements);
  assert.match(index, /telegram-wheel-legacy:start[\s\S]*id="openShopButton"/);
  assert.match(index, /telegram-wheel-legacy:start[\s\S]*id="openPromosButton"/);
});

test('Second wheel design contains one large prize and twenty narrow sectors', async () => {
  const app = await readFile(new URL('app.js', root), 'utf8');
  const list = app.match(/const smallPrizes = \[([\s\S]*?)\];/)?.[1] || '';
  const visualPrizeCodes = [...list.matchAll(/'(bonus-(?:5|10|20|50|100)|beer-glass)'/g)]
    .map((match) => match[1]);

  assert.equal(visualPrizeCodes.length, 20);
  assert.match(app, /code: 'annual-beer'.*start: -22, end: 22/s);
  assert.match(app, /'bonus-5': '5 бонусов'/);
  assert.match(app, /'bonus-10': '10 бонусов'/);
  assert.match(app, /'bonus-20': '20 бонусов'/);
  assert.match(app, /'bonus-50': '50 бонусов'/);
  assert.match(app, /'bonus-100': '100 бонусов'/);
  assert.match(app, /'beer-glass': 'Бокал пива'/);
  assert.doesNotMatch(app, />\s*(?:5|10|20|50|100)Б\s*</);
});

test('Wheel screen uses the approved controls and Eye of Providence emblem', async () => {
  const [index, styles] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('styles.css', root), 'utf8')
  ]);

  assert.match(index, /id="wheelAvailability">Бесплатное вращение доступно/);
  assert.match(index, /id="wheelSpinButton"[^>]*>Крутить бесплатно</);
  assert.match(index, /id="wheelNextFreeHint">Следующее бесплатное вращение — через 24 часа после этого\./);
  assert.match(index, /wheel-emblem-triangle/);
  assert.match(index, /wheel-emblem-eye/);
  assert.match(index, /id="openWheelRulesButton"[^>]*><span>Документы<\/span>/);
  assert.match(styles, /\.app-shell\.wheel-mode \.bottom-nav\s*\{\s*display:\s*none;/);
  assert.match(styles, /\.wheel-sector-jackpot\s*\{/);
});
