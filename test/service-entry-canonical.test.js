import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('Home service entry is canonical markup with role-gated app wiring', async () => {
  const [index, app, css] = await Promise.all([
    read('index.html'),
    read('app.js'),
    read('styles.css')
  ]);

  assert.match(index, /id="homeServiceAccess"/);
  assert.match(index, /id="homeStaffNav"/);
  assert.match(index, /id="homeAdminNav"/);
  assert.doesNotMatch(index, /emergency-service-hotfix\.(?:css|js)/);

  assert.match(app, /#homeStaffNav'\)\?\.classList\.toggle\('hidden', !hasStaffAccess\)/);
  assert.match(app, /#homeAdminNav'\)\?\.classList\.toggle\('hidden', !hasAdminAccess\)/);
  assert.match(app, /#homeServiceAccess'\)\?\.classList\.toggle\('hidden', !hasStaffAccess && !hasAdminAccess\)/);
  assert.match(app, /#homeStaffNav'\)\?\.addEventListener\('click', \(\) => switchScreen\('staff'\)\)/);
  assert.match(app, /#homeAdminNav'\)\?\.addEventListener\('click', \(\) => switchScreen\('admin'\)\)/);

  assert.match(css, /V20\.9 · CANONICAL HOME SERVICE ACCESS/);
  assert.match(css, /\.home-service-access/);
  assert.match(css, /\.home-service-actions/);
});

test('Telegram header color has one canonical runtime source', async () => {
  const [index, app] = await Promise.all([read('index.html'), read('app.js')]);

  assert.match(index, /meta name="theme-color" content="#0b0e13"/);
  assert.match(app, /const TELEGRAM_HEADER_COLOR = '#0b0e13'/);
  assert.match(app, /tg\.setHeaderColor\(TELEGRAM_HEADER_COLOR\)/);
  assert.match(app, /tg\?\.setHeaderColor\(TELEGRAM_HEADER_COLOR\)/);
  assert.doesNotMatch(app, /setHeaderColor\('#f8f3eb'\)/);
});

test('canonical cache key replaces the emergency asset layer', async () => {
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
