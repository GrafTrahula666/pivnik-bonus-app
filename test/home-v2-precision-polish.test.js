import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('Home V2 exposes the real profile avatar and canonical live status layout', async () => {
  const css = await read('styles.css');
  assert.match(css, /V20\.4 · HOME V2 PRECISION POLISH/);
  assert.match(css, /Profile card: canonical live layout based on the approved white-gold reference/);
  assert.match(css, /\.spaceverse-home-hero \.profile-avatar[\s\S]*top: 50%[\s\S]*left: 3\.8%[\s\S]*aspect-ratio: 1/);
  assert.match(css, /\.spaceverse-home-hero \.hero-name-row[\s\S]*grid-template-columns: minmax\(0, 1fr\) 30px/);
  assert.match(css, /\.hero-qr-button[\s\S]*width: 30px[\s\S]*height: 30px[\s\S]*justify-self: end/);
  assert.match(css, /\.spaceverse-home-hero \.status-button[\s\S]*top: 74px[\s\S]*left: 25%/);
  assert.match(css, /\.spaceverse-home-hero \.progress[\s\S]*left: 25%[\s\S]*right: 29\.3%/);
  assert.match(css, /\.spaceverse-hero-brand[\s\S]*display: grid !important/);
});

test('Home wheel prize and CTA keep fixed centered alignment', async () => {
  const css = await read('styles.css');
  assert.match(css, /\.client-home\.home-v2 \.home-wheel-prize\s*\{[^}]*top: 38px;[^}]*align-items: center;[^}]*justify-content: center;[^}]*font-size: clamp\(9px, 2\.7vw, 12px\)/);
  assert.match(css, /\.client-home\.home-v2 \.home-wheel-cta\s*\{[^}]*align-items: center;[^}]*justify-content: center;[^}]*font-size: clamp\(13px, 3\.6vw, 17px\)/);
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
  assert.match(index, /styles\.css\?v=20\.9-service-entry-canonical/);
  assert.match(index, /app\.js\?v=20\.9-service-entry-canonical/);
  assert.match(shell, /CANONICAL_STYLE_VERSION = '20\.9-service-entry-canonical-profile-placement-20260925'/);
});


test('SPACEVERSE teaser masks only the redundant baked left cube', async () => {
  const css = await read('styles.css');
  assert.match(css, /Hide only the baked left cube/);
  assert.match(css, /\.spaceverse-business-card::after[\s\S]*left: 1\.6%/);
  assert.match(css, /\.spaceverse-business-card::after[\s\S]*width: 10\.8%/);
  assert.match(css, /\.spaceverse-business-copy[\s\S]*z-index: 2/);
});
