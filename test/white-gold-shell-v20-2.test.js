import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (name) => readFile(new URL(name, root), 'utf8');

test('white-gold shell remains the global client shell', async () => {
  const [css, index, app] = await Promise.all([
    read('styles.css'),
    read('index.html'),
    read('app.js')
  ]);
  assert.match(css, /V20\.2 · SPACEVERSE white-gold canonical client experience/);
  assert.match(css, /color-scheme:\s*light/);
  assert.match(css, /--bg:\s*#f4efe7/);
  assert.match(index, /styles\.css\?v=20\.11-profile-original-artwork/);
  assert.match(index, /home-canonical\.css\?v=1\.0\.0/);
  assert.match(app, /profileStaffNav[\s\S]*?roleCanStaff/);
  assert.match(app, /profileAdminNav[\s\S]*?roleCanAdmin/);
});

test('canonical Home wires only approved runtime artwork', async () => {
  const css = await read('home-canonical.css');
  for (const asset of [
    'profile-card.webp',
    'business-astronaut-approved.webp',
    'wheel-card.webp',
    'wheel-approved.webp',
    'liters-card.webp',
    'league-card.webp'
  ]) assert.match(css, new RegExp(asset.replace('.', '\\.')));

  assert.doesNotMatch(css, /profile-card\.png/);
  assert.doesNotMatch(css, /wheel-luxury-v1\.webp/);
});
