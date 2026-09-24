import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('Home profile header keeps the approved live structure without baked account data', async () => {
  const [index, css, app] = await Promise.all([
    read('index.html'),
    read('styles.css'),
    read('app.js')
  ]);

  for (const id of [
    'profileAvatar',
    'clientName',
    'clientBalance',
    'statusName',
    'statusProgress',
    'statusProgressText',
    'nextRewardText',
    'heroQrButton'
  ]) {
    assert.match(index, new RegExp(`id="${id}"`), `missing live Home field: ${id}`);
  }

  assert.match(index, /class="spaceverse-hero-brand"/);
  assert.doesNotMatch(index, /class="spaceverse-hero-logo-full"/, 'the static cube lives in the original artwork');

  const marker = css.indexOf('Profile header: positions measured on the untouched 2048 × 682 artwork.');
  assert.ok(marker >= 0, 'canonical profile-header marker must exist');
  const block = css.slice(marker, css.indexOf('/* The SPACEVERSE teaser artwork', marker));

  assert.match(block, /\.client-identity[^}]*inset:\s*0/);
  assert.match(block, /\.profile-avatar[^}]*top:\s*9%[^}]*left:\s*3%[^}]*width:\s*min\(14%, 54px\)/);
  assert.match(block, /\.hero-identity-copy[^}]*left:\s*18\.7%[^}]*width:\s*47%/);
  assert.match(block, /\.status-button[^}]*top:\s*61%[^}]*left:\s*10\.5%/);
  assert.match(block, /\.progress[^}]*top:\s*80%[^}]*left:\s*3\.4%[^}]*height:\s*5\.2%/);
  assert.match(block, /\.spaceverse-hero-brand[^}]*display:\s*block\s*!important/);
  assert.match(block, /\.hero-name-row[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 26px/);
  assert.doesNotMatch(block, /transform:\s*scale/);

  assert.match(css, /\.client-home\.home-v2 \.spaceverse-home-hero \{[\s\S]*height:\s*126px;[\s\S]*min-height:\s*126px;/);
  assert.match(css, /profile-card\.png\?v=6-original-layout/);

  assert.match(app, /renderAvatarInto\(\$\('#profileAvatar'\), profile\)/);
  assert.match(app, /\$\('#clientBalance'\)\.textContent = profile\.unlimitedBonus/);
  assert.match(app, /\$\('#statusName'\)\.textContent = profile\.status\.name/);
  assert.match(app, /profile\.status\.nextSpend/);
  assert.match(app, /profile\.spend12m/);
});

test('Home profile header does not change status business logic', async () => {
  const app = await read('app.js');
  assert.match(app, /const min = Number\(profile\.status\.minSpend \|\| 0\)/);
  assert.match(app, /const next = profile\.status\.nextSpend/);
  assert.match(app, /\(\(profile\.spend12m - min\) \/ \(next - min\)\) \* 100/);
  assert.match(app, /const remaining = Math\.max\(0, next - profile\.spend12m\)/);
});

test('Home artwork preserves the supplied original pixel for pixel', async () => {
  const asset = await readFile(new URL('../assets/home-v2/profile-card.png', import.meta.url));
  assert.equal(asset.readUInt32BE(16), 2048);
  assert.equal(asset.readUInt32BE(20), 682);
  assert.equal(createHash('sha256').update(asset).digest('hex'), 'b1c5a84be372bf1cb7f43a4d26f16e4f3eccfcd2f6cf915156d1fe81b6a17fcb');
});
