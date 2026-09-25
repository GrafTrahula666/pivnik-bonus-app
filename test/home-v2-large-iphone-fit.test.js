import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('canonical Home owns the five-card stack on one shared width', async () => {
  const [index, css] = await Promise.all([read('index.html'), read('home-canonical.css')]);
  assert.match(index, /client-home home-canonical/);
  assert.doesNotMatch(index, /client-home home-v2/);
  assert.match(index, /home-canonical\.css\?v=1\.0\.0/);

  const equalWidth = /\.client-home\.home-canonical > \.spaceverse-home-hero,[\s\S]*?\.home-league-card \{[\s\S]*?width:\s*100%\s*!important[\s\S]*?margin:\s*0\s*!important/;
  assert.match(css, equalWidth);
  assert.doesNotMatch(css, /transform:\s*scale\(/);
});

test('canonical Home keeps approved card heights without cross-card shifts', async () => {
  const css = await read('home-canonical.css');
  assert.match(css, /\.spaceverse-business-card[\s\S]*height:\s*124px\s*!important/);
  assert.match(css, /\.home-wheel-card[\s\S]*height:\s*122px\s*!important/);
  assert.match(css, /\.beer-loyalty-card--compact[\s\S]*height:\s*84px\s*!important/);
  assert.match(css, /\.home-league-card[\s\S]*height:\s*132px\s*!important/);
  assert.match(css, /\.spaceverse-home-hero[\s\S]*aspect-ratio:\s*3\s*\/\s*1/);
});

test('canonical Home survives shell materialization as a separate source', async () => {
  const [index, shell, materializer] = await Promise.all([
    read('index.html'),
    read('scripts/apply-red-cosmos-v2-shell-final.mjs'),
    read('scripts/materialize-runtime-patches.mjs')
  ]);
  assert.match(index, /home-canonical\.css\?v=1\.0\.0/);
  assert.match(shell, /HOME_STYLE_VERSION = '1\.0\.0'/);
  assert.match(shell, /HOME_STYLE_HREF/);
  assert.match(materializer, /canonical Home stylesheet/);
  assert.match(materializer, /canonical Home namespace/);
});
