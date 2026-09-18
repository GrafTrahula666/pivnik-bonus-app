import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('shared black frosted surfaces stay visual-only on VK and Telegram', () => {
  const css = read('black-frosted-surfaces.css');
  assert.match(css, /PIVNIK BLACK FROSTED SURFACES 2026-09-04/);
  assert.match(css, /html\.platform-vk \.hero-card/);
  assert.match(css, /html\.platform-telegram \.hero-card/);
  assert.match(css, /html\.platform-vk \.modal-sheet/);
  assert.match(css, /html\.platform-telegram \.modal-sheet/);
  assert.match(css, /html\.platform-vk \.bottom-nav/);
  assert.match(css, /html\.platform-telegram \.bottom-nav/);
  assert.match(css, /html\.platform-vk \.shop-list-card:not\(\.v2-premium\)/);
  assert.match(css, /html\.platform-telegram \.red-cosmos-shop-card:not\(\.v2-premium\)/);
  assert.match(css, /backdrop-filter: blur\(22px\) saturate\(112%\)/);

  assert.doesNotMatch(css, /\.achievement-tile/);
  assert.doesNotMatch(css, /\.achievement-card/);
  assert.doesNotMatch(css, /\.v2-premium\s*\{/);
  assert.doesNotMatch(css, /(?:pointer-events|position|display|width|height|margin|padding|inset|transform|z-index)\s*:/);
});

test('surface glass respects Android WebView and lite-mode reduced effects', () => {
  const css = read('black-frosted-surfaces.css');
  assert.match(css, /html\.android-webview \.hero-card/);
  assert.match(css, /html\.android-webview \.bottom-nav/);
  assert.match(css, /html\.lite-mode \.hero-card/);
  assert.match(css, /html\.lite-mode \.bottom-nav/);
  assert.match(css, /backdrop-filter: none !important/);
  assert.match(css, /-webkit-backdrop-filter: none !important/);
});

test('materialize wires surface glass strictly after icon glass', () => {
  const shell = read('scripts/apply-red-cosmos-v2-shell-final.mjs');
  assert.match(shell, /BLACK_FROSTED_SURFACES_HREF/);
  assert.match(shell, /black-frosted-surfaces\.css\?v=20260904-1/);
  assert.match(shell, /must load after icon glass/);
});
