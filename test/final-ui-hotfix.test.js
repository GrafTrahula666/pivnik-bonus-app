import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

async function text(file) {
  return fs.readFile(new URL(`../${file}`, import.meta.url), 'utf8');
}

const [materializer, ui, css, pkg, productionStaticVerifier] = await Promise.all([
  text('scripts/apply-final-ui-production-hotfix.mjs'),
  text('final-ui-hotfix.js'),
  text('final-ui-hotfix.css'),
  text('package.json'),
  text('scripts/verify-production-static-ui.mjs')
]);

test('final UI materializer serves root browser assets as real files instead of index.html', () => {
  for (const token of [
    "'/red-cosmos-v2.css': 'red-cosmos-v2.css'",
    "'/red-cosmos-v2.js': 'red-cosmos-v2.js'",
    "'/final-ui-hotfix.css': 'final-ui-hotfix.css'",
    "'/final-ui-hotfix.js': 'final-ui-hotfix.js'",
    "X-Pivnik-Static-Asset",
    "no-store, no-cache"
  ]) assert.match(materializer, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('final UI removes every known VK-only wheel client guard including artwork', () => {
  assert.match(materializer, /renderWheelArtwork/);
  assert.match(materializer, /state\.wheel\.artworkReady/);
  assert.match(materializer, /VK wheel guard remains/);
  assert.match(productionStaticVerifier, /VK wheel guard remains in production app\.js/);
});

test('bottom navigation is explicitly five touch-safe columns on both platforms', () => {
  assert.match(css, /repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(css, /pointer-events:\s*auto\s*!important/);
  assert.doesNotMatch(css, /\.platform-vk\s+\.bottom-nav\s*\{/);
});

test('final controller intercepts navigation at window capture before legacy document gate', () => {
  assert.match(ui, /window\.addEventListener\('click'/);
  assert.match(ui, /capture:\s*true/);
  assert.match(ui, /\.bottom-nav \[data-target\]/);
  assert.match(ui, /forceScreen\(target\.dataset\.target\)/);
  assert.match(ui, /PIVNIK_FINAL_UI_HOTFIX_20260827/);
});

test('final controller guarantees large back controls and removes VK personal short-code UI', () => {
  assert.match(ui, /final-back-button/);
  assert.match(ui, /← Назад/);
  assert.match(ui, /#qrToken/);
  assert.match(ui, /#copyQrCode/);
  assert.match(css, /\.platform-vk #qrToken/);
  assert.match(css, /\.platform-vk #copyQrCode/);
});

test('owner unlimited privilege is rendered as infinity instead of the base 5 percent label', () => {
  assert.match(ui, /profile\?\.unlimitedBonus/);
  assert.match(ui, /bonus\.textContent !== '∞'/);
  assert.match(ui, /profileStatus/);
});

test('final UI materializer is last in prestart and materialize chains', () => {
  const scripts = JSON.parse(pkg).scripts;
  assert.match(scripts.prestart, /apply-final-ui-production-hotfix\.mjs/);
  assert.match(scripts.materialize, /apply-final-ui-production-hotfix\.mjs/);
  assert.ok(scripts.prestart.indexOf('apply-final-ui-production-hotfix.mjs') > scripts.prestart.indexOf('apply-red-cosmos-v2-client-final.mjs'));
});

test('production verifier rejects HTML returned for CSS or JS', () => {
  assert.match(productionStaticVerifier, /browser asset was replaced by index\.html/);
  assert.match(productionStaticVerifier, /wrong content-type/);
  assert.match(productionStaticVerifier, /final-ui-hotfix\.js/);
  assert.match(productionStaticVerifier, /red-cosmos-v2\.css/);
});
