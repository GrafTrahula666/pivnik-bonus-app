import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('approved SPACEVERSE cloud-city background wins after Home V2 shell reset', async () => {
  const css = await read('styles.css');
  const reset = css.indexOf('/* HOME V2 SCENE VISIBILITY */');
  const restore = css.indexOf('/* V20.6 · APP BACKGROUND RESTORE */');

  assert.ok(reset >= 0, 'Home V2 reset marker must exist');
  assert.ok(restore > reset, 'background restore must win later in the CSS cascade');

  const block = css.slice(restore);
  assert.match(block, /\.app-shell::before,[\s\S]*display:\s*block !important/);
  assert.match(block, /spaceverse-cloud-city\.webp\?v=2/);
  assert.match(block, /\.app-shell::after[\s\S]*linear-gradient/);
  assert.match(block, /\.app-shell > main,[\s\S]*z-index:\s*2/);
});

test('restored background is cache-busted in the canonical shell', async () => {
  const [index, shell, materializer] = await Promise.all([
    read('index.html'),
    read('scripts/apply-red-cosmos-v2-shell-final.mjs'),
    read('scripts/materialize-runtime-patches.mjs')
  ]);

  assert.match(index, /styles\.css\?v=20\.7-home-v2-full-height/);
  assert.match(index, /app\.js\?v=20\.7-home-v2-full-height/);
  assert.match(shell, /CANONICAL_STYLE_VERSION = '20\.7-home-v2-full-height'/);
  assert.match(materializer, /styles\.css\?v=20\.7-home-v2-full-height/);
});
