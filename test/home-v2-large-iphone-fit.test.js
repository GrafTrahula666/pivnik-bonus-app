import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('Home V2 fills large iPhone mini-app viewports without shrinking approved cards', async () => {
  const css = await read('styles.css');
  const marker = css.indexOf('HOME V2 · FULL HEIGHT VIEWPORT FIT');
  assert.ok(marker >= 0, 'full-height Home V2 marker must exist');
  const block = css.slice(marker, css.indexOf('/* V20.2.1 · ACHIEVEMENTS WHITE-GOLD REPAIR */', marker));

  assert.match(block, /height:\s*calc\(100dvh - var\(--home-v2-topbar-reserve\) - var\(--home-v2-bottom-reserve\)\)/);
  assert.match(block, /min-height:\s*636px/);
  assert.match(block, /grid-template-rows:[\s\S]*minmax\(126px,\s*1\.05fr\)[\s\S]*minmax\(124px,\s*1\.03fr\)[\s\S]*minmax\(122px,\s*1\.02fr\)[\s\S]*minmax\(84px,\s*\.70fr\)[\s\S]*minmax\(132px,\s*1\.10fr\)/);
  assert.match(block, /\.client-home\.home-v2 > \.spaceverse-home-hero,[\s\S]*height:\s*100%/);
  assert.match(block, /@media \(max-width: 390px\) and \(min-height: 780px\)[\s\S]*\.client-home\.home-v2\.active[\s\S]*--home-v2-topbar-reserve:\s*80px/);
  assert.match(block, /\.platform-telegram \.client-home\.home-v2\.active[\s\S]*--home-v2-topbar-reserve:\s*60px/);

  for (const compressed of ['height: 114px', 'height: 112px', 'height: 110px', 'height: 74px', 'height: 118px']) {
    assert.equal(block.includes(compressed), false, `legacy forced shrink remains: ${compressed}`);
  }
});

test('short mini-app viewports scroll instead of compressing Home V2 artwork', async () => {
  const css = await read('styles.css');
  const marker = css.indexOf('HOME V2 · FULL HEIGHT VIEWPORT FIT');
  const block = css.slice(marker, css.indexOf('/* V20.2.1 · ACHIEVEMENTS WHITE-GOLD REPAIR */', marker));

  assert.match(block, /\.client-home\.home-v2 \.spaceverse-home-hero \{ min-height: 126px; \}/);
  assert.match(block, /\.client-home\.home-v2 \.spaceverse-business-card \{ min-height: 124px; \}/);
  assert.match(block, /\.client-home\.home-v2 \.home-wheel-card \{ min-height: 122px; \}/);
  assert.match(block, /\.client-home\.home-v2 \.beer-loyalty-card--compact \{ min-height: 84px; \}/);
  assert.match(block, /\.client-home\.home-v2 \.home-league-card \{ min-height: 132px; \}/);
  assert.doesNotMatch(block, /transform:\s*scale/);
});

test('Home V2 viewport fix is cache-busted in the canonical shell', async () => {
  const [index, shell] = await Promise.all([
    read('index.html'),
    read('scripts/apply-red-cosmos-v2-shell-final.mjs')
  ]);
  assert.match(index, /styles\.css\?v=20\.10-profile-reference-geometry/);
  assert.match(index, /app\.js\?v=20\.10-profile-reference-geometry/);
  assert.match(shell, /CANONICAL_STYLE_VERSION = '20\.10-profile-reference-geometry'/);
});
