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

test('materialized shell keeps one canonical stylesheet and strips legacy visual CSS', async () => {
  const shell = await read('scripts/apply-red-cosmos-v2-shell-final.mjs');
  assert.match(shell, /CANONICAL_STYLE_VERSION = '20\.2-home-v2-large-iphone-fit'/);
  for (const asset of [
    '/v22.css',
    '/red-cosmos-v2.css',
    '/black-frosted-glass.css',
    '/black-frosted-surfaces.css',
    '/black-frosted-controls.css'
  ]) {
    assert.ok(shell.includes(asset), `${asset} must be explicitly stripped`);
  }
  assert.match(shell, /Legacy visual layer still wired/);
});
