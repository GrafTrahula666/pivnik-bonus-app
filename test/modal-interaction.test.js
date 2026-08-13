import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

async function source(name) {
  return readFile(new URL(name, root), 'utf8');
}

test('open dialogs own pointer input above VK navigation', async () => {
  const [app, css] = await Promise.all([source('app.js'), source('styles.css')]);

  assert.match(app, /function openModal[\s\S]*?document\.body\.classList\.add\('modal-open'\);/);
  assert.match(app, /function closeModal[\s\S]*?if \(!document\.querySelector\('\.modal\.open'\)\) document\.body\.classList\.remove\('modal-open'\);/);
  assert.match(css, /\.modal\s*{[\s\S]*?z-index:\s*2000\s*!important;[\s\S]*?pointer-events:\s*none;/);
  assert.match(css, /\.modal\.open\s*{[\s\S]*?pointer-events:\s*auto;/);
  assert.match(css, /body\.modal-open \.app-shell\s*{[\s\S]*?pointer-events:\s*none;/);
});

test('achievement close and rarity tabs remain wired as buttons', async () => {
  const [app, html, css] = await Promise.all([source('app.js'), source('index.html'), source('styles.css')]);

  assert.match(html, /data-close="achievementsModal"/);
  for (const rarity of ['common', 'rare', 'epic', 'legendary']) {
    assert.match(html, new RegExp(`data-achievement-tab="${rarity}"`));
  }
  assert.match(app, /function selectAchievementTab\(rarity/);
  assert.match(app, /addEventListener\('pointerup', activateAchievementTab, true\)/);
  assert.match(app, /addEventListener\('click', activateAchievementTab, true\)/);
  assert.match(app, /button\.setAttribute\('aria-selected', selected \? 'true' : 'false'\)/);
  assert.match(css, /\.achievement-tabs\s*{[\s\S]*?pointer-events:\s*auto\s*!important;/);
  assert.match(css, /\.achievement-tabs button\s*{[\s\S]*?touch-action:\s*manipulation;/);
  assert.match(css, /\.achievement-catalog\s*{[\s\S]*?overflow-y:\s*auto;/);
  assert.match(app, /\$\$\('\[data-close\]'\)[\s\S]*?addEventListener\('click'[\s\S]*?closeModal\(button\.dataset\.close\)/);
});

test('public copy cleanup preserves empty runtime containers', async () => {
  const [app, releaseScript] = await Promise.all([
    source('app.js'),
    source('scripts/apply-no-beta-public-guard.mjs')
  ]);

  assert.doesNotMatch(app, /\['',\s*''\]/);
  assert.match(app, /if \(!value \|\| !replacements\.has\(value\)\) return;/);
  assert.match(releaseScript, /if \(!value \|\| !replacements\.has\(value\)\) return;/);
});
