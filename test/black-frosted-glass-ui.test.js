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

test('materialize wires glass after red cosmos and Telegram deep-space layers', () => {
  const shell = read('scripts/apply-red-cosmos-v2-shell-final.mjs');
  assert.match(shell, /BLACK_FROSTED_GLASS_HREF/);
  assert.match(shell, /black-frosted-glass\.css\?v=20260904-1/);
  assert.match(shell, /must load after Telegram deep-space/);
});
