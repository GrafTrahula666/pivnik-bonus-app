import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

function block(css, selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `${selector} block missing`);
  const bodyStart = css.indexOf('{', start) + 1;
  const end = css.indexOf('}', bodyStart);
  assert.notEqual(end, -1, `${selector} block is not closed`);
  return css.slice(bodyStart, end);
}

test('global client surfaces keep white-gold contrast instead of legacy dark cards', async () => {
  const css = await read('styles.css');

  assert.match(block(css, '.status-level'), /background:\s*rgba\(255,252,247,\.90\)/);
  assert.doesNotMatch(block(css, '.status-level'), /#14100c/i);
  assert.match(block(css, '.status-rank'), /background:\s*#f7eddb/);
  assert.doesNotMatch(block(css, '.status-rank'), /#2b2119/i);

  assert.match(block(css, '.help-section'), /background:\s*rgba\(255,252,247,\.90\)/);
  assert.doesNotMatch(block(css, '.help-section'), /#14100c/i);
  assert.match(block(css, '.confirm-summary'), /background:\s*rgba\(255,252,247,\.90\)/);
  assert.doesNotMatch(block(css, '.confirm-summary'), /#100d0a/i);
});

test('full wheel screen uses readable white-gold controls while keeping approved artwork', async () => {
  const css = await read('styles.css');

  assert.match(block(css, '.wheel-page-head h2'), /color:\s*#211c16/);
  assert.match(block(css, '.wheel-spin-button'), /background:\s*linear-gradient\(145deg,\s*#fff9eb,\s*#e7c982\)/);
  assert.match(block(css, '.wheel-spin-button'), /color:\s*#2b2115/);
  assert.doesNotMatch(block(css, '.wheel-spin-button'), /rgba\(42,\s*20,\s*22/);
  assert.match(css, /\.wheel-disk\s*\{[\s\S]*?wheel-luxury-v1\.webp\?v=1/);
  assert.match(css, /@keyframes wheelLuxuryWin[\s\S]*?rgba\(211,179,90,\.42\)/);
  assert.doesNotMatch(css, /\.wheel-disk > \*\s*\{\s*opacity:\s*0/);
});

test('league and QR accents remain readable on the light shell', async () => {
  const css = await read('styles.css');

  assert.match(block(css, '.league-summary > strong'), /color:\s*#9b650f/);
  assert.match(block(css, '.league-summary > b'), /color:\s*#806d59/);
  assert.match(block(css, '.token'), /color:\s*#9b650f/);
});

test('canonical Home geometry and loader contract remain intact', async () => {
  const [homeCss, index] = await Promise.all([read('home-canonical.css'), read('index.html')]);

  assert.match(index, /client-home home-canonical/);
  assert.match(index, /home-canonical\.css\?v=1\.0\.0/);
  assert.match(homeCss, /width:\s*100%\s*!important/);
  assert.match(homeCss, /business-astronaut-approved\.webp/);
  assert.match(homeCss, /wheel-approved\.webp/);

  assert.match(index, /id="bootScreen"/);
  assert.match(index, /class="boot-image"/);
  assert.match(index, /id="bootText"/);
});
