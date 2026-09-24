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


test('SPACEVERSE artwork provides the profile logo without a duplicate inline image', async () => {
  const [index, styles] = await Promise.all([
    read('index.html'),
    read('styles.css')
  ]);
  const inlineWebp = index.match(/data:image\/webp;base64,/g) || [];
  assert.ok(inlineWebp.length >= 2, 'expected the compact marks to render as inline WEBP assets');
  assert.doesNotMatch(index, /class="spaceverse-hero-logo-full"/, 'the profile artwork contains its own cube');
  assert.match(index, /class="spaceverse-cube-mark spaceverse-cube-mark--gold" src="data:image\/webp;base64,/);
  assert.doesNotMatch(styles, /\.spaceverse-hero-logo-full/);
  assert.match(styles, /SPACEVERSE USER LOGOS \+ READABILITY PASS/);
});


test('home v2 image composition wires the approved artwork to live home blocks without flattening dynamic data', async () => {
  const [index, app, styles] = await Promise.all([
    read('index.html'),
    read('app.js'),
    read('styles.css')
  ]);

  assert.match(index, /client-home home-v2/);
  assert.doesNotMatch(styles, /home-background\.webp/);
  for (const asset of [
    'profile-card.png',
    'business-card.webp',
    'wheel-card.webp',
    'wheel-luxury-v1.webp',
    'liters-card.webp',
    'league-card.webp'
  ]) {
    assert.match(styles, new RegExp(asset.replace('.', '\\.')));
  }
  assert.match(styles, /HOME V2 IMAGE COMPOSITION/);
  assert.match(styles, /profile-card\.png\?v=6-original-layout/);
  assert.match(styles, /Profile header: positions measured on the untouched 2048 × 682 artwork/);
  assert.match(app, /renderAvatarInto\(\$\('#profileAvatar'\), profile\)/);
  assert.match(app, /avatarInlineHtml\(leader, 'leader-avatar', true\)/);
  assert.match(styles, /\.wheel-disk[\s\S]*wheel-luxury-v1\.webp/);
  assert.match(styles, /\.beer-progress-segments[\s\S]*left: 4\.2%/);
});
