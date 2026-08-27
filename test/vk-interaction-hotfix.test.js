import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const [ui, css] = await Promise.all([
  fs.readFile(new URL('../v22-ui.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../v22.css', import.meta.url), 'utf8')
]);

test('VK interaction fallback runs before document-level blockers and repairs core navigation', () => {
  assert.match(ui, /window\.addEventListener\('click',[\s\S]*true\);/);
  assert.match(ui, /bottom-nav \[data-target\]/);
  assert.match(ui, /forceScreen\(screen\)/);
  assert.match(ui, /id === 'navQrButton'/);
  assert.match(ui, /id === 'openShopButton'/);
  assert.match(ui, /id === 'openWheelButton'/);
  assert.match(ui, /id === 'openAchievementsButton'/);
  assert.match(ui, /id === 'openStatuses'/);
  assert.match(ui, /consentGateVisible\(\)/);
});

test('VK opened modals always stack above fixed navigation and decorative layers never capture clicks', () => {
  assert.match(css, /\.platform-vk \.bottom-nav \{[\s\S]*grid-template-columns: repeat\(5/);
  assert.match(css, /\.platform-vk \.modal\.open \{[\s\S]*z-index: 4000/);
  assert.match(css, /\.platform-vk #consentModal\.open \{[\s\S]*z-index: 5000/);
  assert.match(css, /\.platform-vk \.app-shell::before,[\s\S]*pointer-events: none !important/);
  assert.match(css, /\.platform-vk button:not\(:disabled\)[\s\S]*pointer-events: auto !important/);
});
