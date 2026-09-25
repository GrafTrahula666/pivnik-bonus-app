import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (name) => fs.readFile(new URL(name, root), 'utf8');

test('home liter path still renders fourteen live segments', async () => {
  const [index, app, css] = await Promise.all([
    read('index.html'),
    read('app.js'),
    read('home-canonical.css')
  ]);
  const segments = index.match(/class="beer-progress-segment"/g) || [];
  assert.equal(segments.length, 14);
  assert.match(app, /const segmentCount = 14;/);
  assert.match(app, /--segment-fill/);
  assert.match(css, /grid-template-columns:\s*repeat\(14,\s*minmax\(0,1fr\)\)/);
});

test('Home uses the canonical namespace and approved static assets without flattening live data', async () => {
  const [index, app, css] = await Promise.all([
    read('index.html'),
    read('app.js'),
    read('home-canonical.css')
  ]);
  assert.match(index, /client-home home-canonical/);
  assert.doesNotMatch(index, /client-home home-v2/);
  assert.match(css, /profile-card\.webp/);
  assert.match(css, /business-astronaut-approved\.webp/);
  assert.match(css, /wheel-approved\.webp/);
  assert.match(app, /renderAvatarInto\(\$\('#profileAvatar'\), profile\)/);
  assert.match(app, /avatarInlineHtml\(leader, 'leader-avatar', true\)/);
});

test('Home wheel entry remains a real button into the existing wheel flow', async () => {
  const [index, app] = await Promise.all([read('index.html'), read('app.js')]);
  assert.match(index, /id="openWheelButton"/);
  assert.match(index, /id="wheelSpinButton"/);
  assert.match(app, /openWheelButton/);
});
