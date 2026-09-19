import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function read(name) {
  return readFile(new URL(name, root), 'utf8');
}

test('universal server serves all root black-frosted CSS assets before HTML fallback', async () => {
  const source = await read('universal-server.js');
  const assets = [
    'black-frosted-glass.css',
    'black-frosted-surfaces.css',
    'black-frosted-controls.css'
  ];

  for (const asset of assets) {
    const file = await read(asset);
    assert.ok(file.length > 100, `${asset} must exist and contain CSS`);

    const route = `url.pathname === '/${asset}'`;
    const routeIndex = source.indexOf(route);
    assert.ok(routeIndex > 0, `${asset} must have an explicit universal-server route`);

    const routeWindow = source.slice(routeIndex, routeIndex + 260);
    assert.match(routeWindow, /serveFile\(/);
    assert.match(routeWindow, /text\/css; charset=utf-8/);
    assert.match(routeWindow, /no-cache/);
  }

  const legalMarker = source.indexOf("url.pathname === '/legal/privacy'");
  for (const asset of assets) {
    assert.ok(
      source.indexOf(`url.pathname === '/${asset}'`) < legalMarker,
      `${asset} must be handled before later request fallbacks`
    );
  }
});

test('materialized shell references only root CSS assets that universal server knows how to serve', async () => {
  const [source, shell] = await Promise.all([
    read('universal-server.js'),
    read('scripts/apply-red-cosmos-v2-shell-final.mjs')
  ]);
  const hrefs = [...shell.matchAll(/BLACK_FROSTED_[A-Z_]+_HREF\s*=\s*'\/([^?']+)/g)]
    .map((match) => match[1]);

  assert.deepEqual(hrefs.sort(), [
    'black-frosted-controls.css',
    'black-frosted-glass.css',
    'black-frosted-surfaces.css'
  ]);

  for (const asset of hrefs) {
    assert.match(source, new RegExp(`url\\.pathname === '/${asset.replaceAll('.', '\\.')}'`));
  }
});
