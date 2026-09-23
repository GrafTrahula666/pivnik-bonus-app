import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (name) => readFile(new URL(name, root), 'utf8');

test('Home V2 production shell keeps the white-gold cache key and five-column navigation', async () => {
  const [index, css, shell] = await Promise.all([
    read('index.html'),
    read('styles.css'),
    read('scripts/apply-red-cosmos-v2-shell-final.mjs')
  ]);

  assert.match(index, /styles\.css\?v=20\.7-home-v2-full-height/);
  assert.match(index, /app\.js\?v=20\.7-home-v2-full-height/);
  assert.match(shell, /CANONICAL_STYLE_VERSION = '20\.7-home-v2-full-height'/);
  assert.match(css, /\.bottom-nav\s*\{[\s\S]*?grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/);

  const nav = index.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/)?.[0] || '';
  const expectedOrder = [
    'data-target="client"',
    'data-target="league"',
    'id="navQrButton"',
    'id="openAchievementsButton"',
    'data-target="profile"'
  ];
  let cursor = -1;
  for (const token of expectedOrder) {
    const next = nav.indexOf(token);
    assert.ok(next > cursor, `navigation token out of order or missing: ${token}`);
    cursor = next;
  }
  assert.doesNotMatch(nav, />Акции</);
  assert.equal((index.match(/id="openAchievementsButton"/g) || []).length, 1);
});

test('bootstrap-vlad materializer is restart-safe after its cache patch is already present', async () => {
  const source = await read('bootstrap-vlad.js');
  assert.match(source, /vladCachePatchAlreadyApplied/);
  assert.match(source, /версия стилей Владислава/);
  assert.match(source, /версия клиента Владислава/);
});

test('materializer recognizes the white-gold Home V2 asset version as already canonical', async () => {
  const source = await read('scripts/materialize-runtime-patches.mjs');
  assert.match(source, /styles\.css\?v=20\.7-home-v2-full-height/);
  assert.match(source, /supportedAssetVersion/);
});
