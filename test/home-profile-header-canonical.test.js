import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('profile header keeps all account-specific fields live', async () => {
  const [index, app, css] = await Promise.all([
    read('index.html'),
    read('app.js'),
    read('home-canonical.css')
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
  ]) assert.match(index, new RegExp(`id="${id}"`), `missing live field ${id}`);

  assert.match(app, /renderAvatarInto\(\$\('#profileAvatar'\), profile\)/);
  assert.match(app, /\$\('#statusName'\)\.textContent = profile\.status\.name/);
  assert.match(app, /profile\.status\.nextSpend/);
  assert.match(app, /profile\.spend12m/);

  assert.match(css, /profile-card\.webp\?v=canonical-1/);
  assert.doesNotMatch(css, /profile-card\.png/);
});

test('profile header uses one card-relative coordinate system', async () => {
  const css = await read('home-canonical.css');
  assert.match(css, /\.spaceverse-hero-grid,[\s\S]*?\.client-identity \{[\s\S]*?inset:\s*0\s*!important/);
  assert.match(css, /\.profile-avatar \{[\s\S]*?left:\s*5\.25%\s*!important/);
  assert.match(css, /\.hero-identity-copy \{[\s\S]*?left:\s*23\.8%\s*!important/);
  assert.match(css, /\.balance \{[\s\S]*?left:\s*23\.8%\s*!important/);
  assert.match(css, /\.status-button \{[\s\S]*?left:\s*23\.8%\s*!important/);
  assert.match(css, /\.progress \{[\s\S]*?left:\s*16\.0%\s*!important/);
  assert.doesNotMatch(css, /transform:\s*scale\(/);
});

test('profile uses the prepared non-empty 960x320 WEBP asset', async () => {
  const asset = new URL('../assets/home-v2/profile-card.webp', import.meta.url);
  const info = await stat(asset);
  assert.ok(info.size > 7000, 'prepared profile-card.webp must exist and be non-empty');
  const bytes = await readFile(asset);
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
});

test('status progression business logic is untouched', async () => {
  const app = await read('app.js');
  assert.match(app, /const min = Number\(profile\.status\.minSpend \|\| 0\)/);
  assert.match(app, /const next = profile\.status\.nextSpend/);
  assert.match(app, /\(\(profile\.spend12m - min\) \/ \(next - min\)\) \* 100/);
  assert.match(app, /const remaining = Math\.max\(0, next - profile\.spend12m\)/);
});
