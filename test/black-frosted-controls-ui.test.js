import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('bottom navigation outer controls stay neutral on VK and Telegram', () => {
  const css = read('black-frosted-controls.css');
  assert.match(css, /PIVNIK BLACK FROSTED CONTROLS 2026-09-04/);
  assert.match(css, /html\.platform-vk \.bottom-nav button\.active/);
  assert.match(css, /html\.platform-telegram \.bottom-nav button\.active/);
  assert.match(css, /html\.platform-vk \.bottom-nav \.qr-nav-button\.active/);
  assert.match(css, /html\.platform-telegram \.bottom-nav \.qr-nav-button\.active/);
  assert.match(css, /background:\s*transparent !important/);
  assert.match(css, /box-shadow:\s*none !important/);

  assert.doesNotMatch(css, /(?:pointer-events|position|display|width|height|margin|padding|inset|transform|z-index)\s*:/);
  assert.doesNotMatch(css, /rgba\((?:196,\s*30,\s*58|111,\s*31,\s*43|47,\s*8,\s*31)/);
});

test('neutral control chrome is materialized after black frosted surfaces', () => {
  const shell = read('scripts/apply-red-cosmos-v2-shell-final.mjs');
  assert.match(shell, /BLACK_FROSTED_CONTROLS_HREF/);
  assert.match(shell, /black-frosted-controls\.css\?v=20260904-1/);
  assert.match(shell, /Black frosted controls layer must load after surfaces/);
});
