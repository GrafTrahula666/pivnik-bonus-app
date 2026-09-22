import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('Home V2 has a large-iPhone viewport fit without changing approved artwork', async () => {
  const css = await read('styles.css');
  assert.match(css, /HOME V2 · LARGE IPHONE VIEWPORT FIT/);
  assert.match(css, /@media \(max-width: 480px\) and \(max-height: 950px\)/);
  assert.match(css, /\.client-home\.home-v2 \.spaceverse-home-hero[\s\S]*height: 114px/);
  assert.match(css, /\.client-home\.home-v2 \.spaceverse-business-card[\s\S]*height: 112px/);
  assert.match(css, /\.client-home\.home-v2 \.home-wheel-card[\s\S]*height: 110px/);
  assert.match(css, /\.client-home\.home-v2 \.beer-loyalty-card--compact[\s\S]*height: 74px/);
  assert.match(css, /\.client-home\.home-v2 \.home-league-card[\s\S]*height: 118px/);
  assert.match(css, /\.platform-telegram \.topbar[\s\S]*height: 60px/);
});

test('Home V2 viewport fix is cache-busted in the canonical shell', async () => {
  const [index, shell] = await Promise.all([
    read('index.html'),
    read('scripts/apply-red-cosmos-v2-shell-final.mjs')
  ]);
  assert.match(index, /styles\.css\?v=20\.2-home-v2-large-iphone-fit/);
  assert.match(index, /app\.js\?v=20\.2-home-v2-large-iphone-fit/);
  assert.match(shell, /CANONICAL_STYLE_VERSION = '20\.2-home-v2-large-iphone-fit'/);
});
