import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
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

test('Luxury wheel contains one large jackpot and twenty-seven alternating prize sectors', async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL('app.js', root), 'utf8'),
    readFile(new URL('styles.css', root), 'utf8')
  ]);
  const list = app.match(/const smallPrizes = \[([\s\S]*?)\];/)?.[1] || '';
  const visualPrizeCodes = [...list.matchAll(/'(bonus-(?:5|10|20|50|100)|beer-glass)'/g)]
    .map((match) => match[1]);

  assert.equal(visualPrizeCodes.length, 27);
  assert.match(app, /const jackpotDegrees = 34/);
  assert.match(app, /'bonus-5': '5 б'/);
  assert.match(app, /'bonus-10': '10 б'/);
  assert.match(app, /'bonus-20': '20 б'/);
  assert.match(app, /'bonus-50': '50 б'/);
  assert.match(app, /'bonus-100': '100 б'/);
  assert.match(app, /'beer-glass': 'Пиво'/);
  assert.match(app, /tone: index % 2 === 0 \? 'white' : 'gold'/);
  assert.match(app, /wheelPoint\(sector\.center, 116\)/);
  assert.doesNotMatch(app, /labelRotation/);
  assert.doesNotMatch(app, /transform="rotate\([^"]+\)">\$\{escapeHtml\(sector\.label\)\}/);
  assert.match(styles, /wheel-luxury-v1\.webp\?v=1/);
  assert.match(styles, /\.wheel-sector-white/);
  assert.match(styles, /\.wheel-sector-gold/);
  assert.match(app, /wheelJackpotPrism/);
  assert.doesNotMatch(styles, /\.wheel-disk > \*\s*\{\s*opacity:\s*0/);
});

test('rendering beer progress updates every segment without throwing on wheel result refresh', async () => {
  const source = await readFile(new URL('app.js', root), 'utf8');
  const body = source.match(/function renderBeer\([\s\S]*?\n}\n\nfunction imageMarkup/)?.[0].replace(/\n\nfunction imageMarkup$/, '');
  assert.ok(body, 'renderBeer must be available');
  const segments = Array.from({ length: 14 }, () => ({
    style: { setProperty(name, value) { this[name] = value; } },
    classList: { toggle() {} }
  }));
  const nodes = new Map();
  for (const id of ['beerProgressBar', 'beerProgressText', 'beerRemainingText', 'beerGiftBalance', 'beerGiftReady', 'beerLoyaltyCard']) {
    nodes.set(`#${id}`, { textContent: '', setAttribute() {}, classList: { toggle() {} } });
  }
  const context = {
    $: (selector) => nodes.get(selector),
    fmtLiters: String
  };
  context[String.fromCharCode(36, 36)] = (selector) => selector === '#beerProgressBar .beer-progress-segment' ? segments : [];
  const render = runInNewContext(`${body}; renderBeer`, context);
  render({ beer: { paidTargetLiters: 14, progressLiters: 2.5, nextGiftLiters: 11.5, giftLitersBalance: 1 } });
  assert.equal(segments[0].style['--segment-fill'], '100%');
  assert.equal(segments[1].style['--segment-fill'], '100%');
  assert.equal(segments[2].style['--segment-fill'], '50%');
  assert.equal(segments[3].style['--segment-fill'], '0%');
  assert.equal(nodes.get('#beerGiftBalance').textContent, '1');
});

test('materialized RED COSMOS keeps the wheel back label compact', async () => {
  const [overlay, v22, materializer] = await Promise.all([
    readFile(new URL('red-cosmos-v2.js', root), 'utf8'),
    readFile(new URL('v22-ui.js', root), 'utf8'),
    readFile(new URL('scripts/apply-working-updates.mjs', root), 'utf8')
  ]);
  assert.match(overlay, /button\.id === 'wheelBackButton' \? '←' : '← Назад'/);
  assert.ok(v22.includes("wheelBack.innerHTML = '<span aria-hidden=\"true\">←</span>';"));
  assert.ok(!v22.includes("wheelBack.innerHTML = '<span aria-hidden=\"true\">←</span><span>Назад</span>';"));
  assert.match(materializer, /compactWheelBack/);
  assert.match(materializer, /wheel back label/);
});

test('Wheel screen keeps functional controls and uses the luxury crown hub', async () => {
  const [index, styles] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('styles.css', root), 'utf8')
  ]);

  assert.match(index, /id="wheelAvailability">Бесплатное вращение доступно/);
  assert.match(index, /id="wheelSpinButton"[^>]*>Крутить бесплатно</);
  assert.match(index, /id="wheelNextFreeHint">Следующее бесплатное вращение — через 24 часа после этого\./);
  assert.match(index, /<div class="wheel-emblem" aria-hidden="true"><\/div>/);
  assert.doesNotMatch(index, /wheel-emblem-eye/);
  assert.match(styles, /\.wheel-emblem::before[\s\S]*content: "♛"/);
  assert.match(index, /id="openWheelRulesButton"[^>]*><span>Документы<\/span>/);
  assert.match(styles, /\.app-shell\.wheel-mode \.bottom-nav\s*\{\s*display:\s*none;/);
  assert.match(styles, /\.wheel-sector-jackpot\s*\{/);
});
