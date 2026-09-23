import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('Home V2 exposes the real profile avatar and right-column status', async () => {
  const css = await read('styles.css');
  assert.match(css, /V20\.4 · HOME V2 PRECISION POLISH/);
  assert.match(css, /\.spaceverse-home-hero \.profile-avatar[\s\S]*top: 7px[\s\S]*left: 3\.4%/);
  assert.match(css, /\.spaceverse-home-hero \.hero-name-row[\s\S]*grid-template-columns: minmax\(0, 1fr\) 30px/);
  assert.match(css, /\.hero-qr-button[\s\S]*width: 30px[\s\S]*justify-self: end/);
  assert.match(css, /\.spaceverse-home-hero \.status-button[\s\S]*top: 58px[\s\S]*right: 4\.1%/);
  assert.match(css, /\.spaceverse-home-hero \.progress[\s\S]*left: 3\.4%/);
});

test('Home wheel prize and CTA keep fixed centered alignment', async () => {
  const css = await read('styles.css');
  assert.match(css, /\.home-wheel-prize[\s\S]*top: 39px/);
  assert.match(css, /\.home-wheel-cta[\s\S]*justify-content: center/);
  assert.match(css, /\.home-wheel-cta[\s\S]*font-size: 12px/);
  assert.match(css, /\.home-wheel-timer[\s\S]*text-align: center/);
});

test('Home league top 3 uses centered circular avatars and larger copy', async () => {
  const css = await read('styles.css');
  assert.match(css, /\.home-league-podium > span[\s\S]*grid-template-columns: 1fr/);
  assert.match(css, /\.home-league-podium \.leader-avatar[\s\S]*border-radius: 50% !important/);
  assert.match(css, /\.home-league-podium b[\s\S]*font-size: 8\.6px/);
  assert.match(css, /\.home-league-podium strong[\s\S]*font-size: 8\.4px/);
});

test('Home V2 precision polish is cache-busted', async () => {
  const [index, shell] = await Promise.all([
    read('index.html'),
    read('scripts/apply-red-cosmos-v2-shell-final.mjs')
  ]);
  assert.match(index, /styles\.css\?v=20\.7-home-v2-full-height/);
  assert.match(index, /app\.js\?v=20\.7-home-v2-full-height/);
  assert.match(shell, /CANONICAL_STYLE_VERSION = '20\.7-home-v2-full-height'/);
});


test('SPACEVERSE teaser masks only the redundant baked left cube', async () => {
  const css = await read('styles.css');
  assert.match(css, /Hide only the baked left cube/);
  assert.match(css, /\.spaceverse-business-card::after[\s\S]*left: 1\.6%/);
  assert.match(css, /\.spaceverse-business-card::after[\s\S]*width: 10\.8%/);
  assert.match(css, /\.spaceverse-business-copy[\s\S]*z-index: 2/);
});
