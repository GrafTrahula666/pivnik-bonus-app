import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('legacy loader decoration is removed from active runtime sources', async () => {
  const [index, styles, loader] = await Promise.all([
    read('index.html'),
    read('styles.css'),
    read('loader-fix.css')
  ]);

  const forbidden = [
    'boot-overlay',
    'boot-sign-glitch',
    'shooting-star',
    'boot-person',
    'boot-smoke',
    'sign-layer',
    'sign-main',
    'sign-red',
    'sign-cyan',
    'pivnik-sign.png',
    'pivnik-boot-person.png'
  ];

  for (const token of forbidden) {
    assert.doesNotMatch(index, new RegExp(token.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&')));
    assert.doesNotMatch(styles, new RegExp(token.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&')));
    assert.doesNotMatch(loader, new RegExp(token.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&')));
  }

  assert.match(index, /class="boot-image"/);
  assert.match(index, /class="boot-copy"/);
});

test('loader geometry stylesheet is cache-busted after cleanup', async () => {
  const [server, patcher] = await Promise.all([
    read('universal-server.js'),
    read('scripts/apply-release-candidate-fixes.mjs')
  ]);
  assert.match(server, /loader-fix\.css\?v=2\.2\.0/);
  assert.match(patcher, /loader-fix\.css\?v=2\.2\.0/);
});
