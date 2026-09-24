import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
  assert.match(index, /class="spaceverse-hero-logo-full"/);

  const marker = css.indexOf('Profile card: canonical live layout based on the approved white-gold reference.');
  assert.ok(marker >= 0, 'canonical profile-header marker must exist');
  const block = css.slice(marker, css.indexOf('/* The SPACEVERSE teaser artwork', marker));

  assert.match(block, /\.profile-avatar[\s\S]*display:\s*grid\s*!important/);
  assert.match(block, /\.spaceverse-hero-brand[\s\S]*display:\s*grid\s*!important/);
  assert.match(block, /\.status-divider[\s\S]*display:\s*block\s*!important/);
  assert.match(block, /\.spaceverse-hero-logo-full[\s\S]*object-fit:\s*contain/);
  assert.match(block, /\.progress[\s\S]*left:\s*27%[\s\S]*right:\s*27\.3%/);
  assert.doesNotMatch(block, /transform:\s*scale/);

  assert.match(css, /\.client-home\.home-v2 \.spaceverse-home-hero \{[\s\S]*height:\s*126px;[\s\S]*min-height:\s*126px;/);
  assert.doesNotMatch(css, /profile-card\.webp\?v=3/);

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
