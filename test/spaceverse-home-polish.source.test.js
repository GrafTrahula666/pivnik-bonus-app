import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (name) => fs.readFile(new URL(name, root), 'utf8');

test('home liter path renders fourteen equal progress segments driven by existing beer state', async () => {
  const [index, app, styles] = await Promise.all([
    read('index.html'),
    read('app.js'),
    read('styles.css')
  ]);

  const segments = index.match(/class="beer-progress-segment"/g) || [];
  assert.equal(segments.length, 14);
  assert.match(app, /const segmentCount = 14;/);
  assert.match(app, /--segment-fill/);
  assert.match(styles, /grid-template-columns: repeat\(14, minmax\(0, 1fr\)\)/);
});

test('home wheel uses six vector prize icons and premium ring styling', async () => {
  const [index, styles] = await Promise.all([
    read('index.html'),
    read('styles.css')
  ]);

  const icons = index.match(/class="wheel-icon /g) || [];
  assert.equal(icons.length, 6);
  assert.match(index, /wheel-icon-gift/);
  assert.match(index, /wheel-icon-hop/);
  assert.match(index, /wheel-icon-crown/);
  assert.match(styles, /\.home-wheel-ring b svg/);
  assert.match(styles, /radial-gradient\(circle at 34% 28%/);
});

test('SPACEVERSE logo is the redrawn seven-cube reference mark', async () => {
  const logo = await read('assets/spaceverse/logo-gold.svg');
  assert.match(logo, /viewBox="0 0 120 120"/);
  assert.match(logo, /<!-- center -->/);
  assert.match(logo, /glassFront/);
  assert.match(logo, /edgeGlow/);
});
