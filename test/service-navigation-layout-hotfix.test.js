import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('screen router iterates screen and navigation collections', async () => {
  const app = await read('app.js');
  assert.match(app, /\$\$\('\.screen'\)\.forEach/);
  assert.match(app, /\$\$\('\.bottom-nav \[data-target\]'\)\.forEach/);
  assert.doesNotMatch(app, /(^|[^$])\$\('\.screen'\)\.forEach/m);
  assert.doesNotMatch(app, /(^|[^$])\$\('\.bottom-nav \[data-target\]'\)\.forEach/m);
});

test('configured Telegram owner is exposed with effective admin role', async () => {
  const server = await read('universal-server.js');
  assert.match(server, /role: isOwnerRow\(row\) \? 'admin' : row\.role/);
});

test('service panels and iPhone safe area keep a stable final shell override', async () => {
  const [css, index] = await Promise.all([read('styles.css'), read('index.html')]);
  assert.match(css, /V20\.3 · SERVICE NAVIGATION \+ IPHONE LAYOUT STABILIZATION/);
  assert.match(css, /min-height: calc\(78px \+ env\(safe-area-inset-bottom\)\) !important/);
  assert.match(css, /\.service-access button:not\(\.hidden\)/);
  assert.match(css, /screen\[data-screen="staff"\]\.active/);
  assert.match(css, /screen\[data-screen="admin"\]\.active/);
  assert.match(index, /styles\.css\?v=20\.3-service-layout-hotfix/);
  assert.match(index, /app\.js\?v=20\.3-service-layout-hotfix/);
});

// Complete hotfix head validation.
