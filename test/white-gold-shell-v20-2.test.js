import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (name) => readFile(new URL(name, root), 'utf8');

test('v20.2 replaces the legacy dark shell at its source', async () => {
  const [css, index, app] = await Promise.all([
    read('styles.css'),
    read('index.html'),
    read('app.js')
  ]);

  assert.match(css, /V20\.2 · SPACEVERSE white-gold canonical client experience/);
  assert.doesNotMatch(css, /Luxury VIP Space client experience/);
  assert.doesNotMatch(css, /\/assets\/backgrounds\/luxury-vip-space\.webp/);
  assert.doesNotMatch(css, /\/assets\/home-v2\/home-background\.webp/);
  assert.match(css, /color-scheme:\s*light/);
  assert.match(css, /--bg:\s*#f4efe7/);
  assert.match(css, /HOME V2 CLEAN SHELL BACKDROP/);
  assert.match(css, /grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/);

  assert.match(index, /styles\.css\?v=20\.9-service-entry-canonical/);
  assert.match(index, /app\.js\?v=20\.9-service-entry-canonical/);
  assert.doesNotMatch(index, /<\/section>\\n\\n\s*<section class="profile-history-card/);
  assert.match(index, /<\/section>\n\n\s*<section class="profile-history-card/);

  const serviceAccess = index.indexOf('id="profileServiceAccess"');
  const history = index.indexOf('class="profile-history-card');
  assert.ok(serviceAccess > 0 && serviceAccess < history, 'authorized role tools must sit near the top of Profile');

  assert.match(app, /profileStaffNav[\s\S]*?roleCanStaff/);
  assert.match(app, /profileAdminNav[\s\S]*?roleCanAdmin/);
});

test('approved Home V2 card artwork stays wired while the shell texture is removed', async () => {
  const css = await read('styles.css');
  for (const asset of [
    'business-card.webp',
    'wheel-card.webp',
    'wheel-luxury-v1.webp',
    'liters-card.webp',
    'league-card.webp'
  ]) assert.match(css, new RegExp(asset.replace('.', '\\.')));

  assert.doesNotMatch(css, /profile-card\.webp/);
  assert.match(css, /Profile card: canonical live layout based on the approved white-gold reference/);
  assert.match(css, /\.spaceverse-hero-brand[\s\S]*display: grid !important/);
  assert.match(css, /\.spaceverse-home-hero \.profile-avatar[\s\S]*display: grid !important/);

  assert.match(css, /profile-achievement-medal\.rarity-epic[^}]*rgba\(180,124,33/);
  assert.match(css, /profile-achievement-medal\.rarity-rare[^}]*rgba\(180,124,33/);
  assert.doesNotMatch(css, /rgba\(190,100,255,.65\)|rgba\(74,153,255,.6\)/);
});
