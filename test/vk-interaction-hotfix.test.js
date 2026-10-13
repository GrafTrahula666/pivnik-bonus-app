import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const ui = await fs.readFile(new URL('../v22-ui.js', import.meta.url), 'utf8');

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

