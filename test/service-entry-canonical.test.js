import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('service entry stays in Profile and cannot distort Home V2 grid', async () => {
  const [index, app] = await Promise.all([read('index.html'), read('app.js')]);

  assert.match(index, /id="profileServiceAccess"/);
  assert.match(index, /id="profileStaffNav"/);
  assert.match(index, /id="profileAdminNav"/);
  assert.doesNotMatch(index, /id="homeServiceAccess"|id="homeStaffNav"|id="homeAdminNav"/);

  const renderStart = app.indexOf('function renderProfile() {');
  assert.ok(renderStart >= 0);
  const earlyRender = app.slice(renderStart, renderStart + 1600);
  assert.match(earlyRender, /const hasStaffAccess = roleCanStaff\(profile\.role\);/);
  assert.match(earlyRender, /const hasAdminAccess = roleCanAdmin\(profile\.role\);/);
  assert.match(earlyRender, /#profileStaffNav/);
  assert.match(earlyRender, /#profileAdminNav/);
  assert.match(earlyRender, /(?:#profileServiceAccess|const serviceAccess = \$\('#profileServiceAccess'\))/);
  assert.doesNotMatch(app, /#homeStaffNav|#homeAdminNav|#homeServiceAccess/);
});

test('Telegram header color has one canonical runtime source', async () => {
  const [index, app] = await Promise.all([read('index.html'), read('app.js')]);

  assert.match(index, /meta name="theme-color" content="#0b0e13"/);
  assert.match(app, /const TELEGRAM_HEADER_COLOR = '#0b0e13'/);
  assert.match(app, /tg\.setHeaderColor\(TELEGRAM_HEADER_COLOR\)/);
  assert.match(app, /tg\?\.setHeaderColor\(TELEGRAM_HEADER_COLOR\)/);
  assert.doesNotMatch(app, /setHeaderColor\('#f8f3eb'\)/);
});

test('canonical cache key remains materializer-compatible', async () => {
  const [index, shell, materializer] = await Promise.all([
    read('index.html'),
    read('scripts/apply-red-cosmos-v2-shell-final.mjs'),
    read('scripts/materialize-runtime-patches.mjs')
  ]);

  assert.match(index, /styles\.css\?v=20\.9-service-entry-canonical/);
  assert.match(index, /app\.js\?v=20\.9-service-entry-canonical/);
  assert.match(shell, /CANONICAL_STYLE_VERSION = '20\.9-service-entry-canonical'/);
  assert.match(materializer, /styles\.css\?v=20\.9-service-entry-canonical/);
});
