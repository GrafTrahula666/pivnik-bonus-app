import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('shared black frosted glass styles only target visual icon containers on VK and Telegram', () => {
  const css = read('black-frosted-glass.css');
  assert.match(css, /PIVNIK BLACK FROSTED GLASS 2026-09-04/);
  assert.match(css, /html\.platform-vk \.bottom-nav button:not\(\.qr-nav-button\) > span/);
  assert.match(css, /html\.platform-telegram \.bottom-nav button:not\(\.qr-nav-button\) > span/);
  assert.match(css, /html\.platform-vk \.bottom-nav \.qr-nav-button > span/);
  assert.match(css, /html\.platform-telegram \.bottom-nav \.qr-nav-button > span/);
  assert.match(css, /html\.platform-vk \.profile-shortcuts button > span/);
  assert.match(css, /html\.platform-telegram \.profile-menu > button > span/);
  assert.match(css, /html\.platform-vk \.wheel-entry-mark/);
  assert.match(css, /html\.platform-telegram \.achievement-tile-icon/);
  assert.match(css, /backdrop-filter: blur\(18px\) saturate\(112%\)/);
  assert.doesNotMatch(css, /pointer-events/);
  assert.doesNotMatch(css, /position:\s*fixed/);
});

test('VK icon surfaces are hardened to matte black instead of red-tinted translucent glass', () => {
  const css = read('black-frosted-glass.css');
  const hardening = css.split('/* VK MATTE ICON HARDENING 2026-09-04')[1] || '';

  assert.ok(hardening, 'VK matte icon hardening block must exist');
  assert.match(hardening, /rgba\(8, 9, 12, \.97\)/);
  assert.match(hardening, /rgba\(0, 0, 0, \.93\)/);
  assert.match(hardening, /html\.platform-vk \.close/);
  assert.match(hardening, /html\.platform-vk \.profile-shortcuts button > span/);
  assert.match(hardening, /html\.platform-vk \.profile-menu > button > span/);
  assert.match(hardening, /html\.platform-vk \.bottom-nav button > span/);
  assert.match(hardening, /html\.platform-vk \.home-promo-banner > i/);
  assert.match(hardening, /html\.platform-vk \.wheel-rules-link > i/);
  assert.match(hardening, /saturate\(32%\) brightness\(62%\)/);
  assert.doesNotMatch(hardening, /rgba\(196,\s*30,\s*58/);
  assert.doesNotMatch(hardening, /#c41e3a/i);
});

test('glass respects Android WebView and lite-mode reduced effects', () => {
  const css = read('black-frosted-glass.css');
  assert.match(css, /html\.android-webview \.icon-btn/);
  assert.match(css, /html\.android-webview \.bottom-nav button > span/);
  assert.match(css, /html\.lite-mode \.icon-btn/);
  assert.match(css, /html\.lite-mode \.bottom-nav button > span/);
  assert.match(css, /backdrop-filter: none !important/);
  assert.match(css, /-webkit-backdrop-filter: none !important/);
});

test('materialize wires glass after red cosmos and Telegram deep-space layers', () => {
  const shell = read('scripts/apply-red-cosmos-v2-shell-final.mjs');
  assert.match(shell, /BLACK_FROSTED_GLASS_HREF/);
  assert.match(shell, /black-frosted-glass\.css\?v=20260904-1/);
  assert.match(shell, /must load after Telegram deep-space/);
});
