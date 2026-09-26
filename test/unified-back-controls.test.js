import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('all canonical exit controls use the same visible Back component', async () => {
  const [index, app, css] = await Promise.all([
    read('index.html'),
    read('app.js'),
    read('styles.css')
  ]);

  for (const id of [
    'spaceverseBusinessBack',
    'wheelBackButton',
    'backToProfileFromStaff',
    'backToProfileFromAdmin'
  ]) {
    assert.match(
      index,
      new RegExp(`<button[^>]*class="[^"]*app-back-button[^"]*"[^>]*id="${id}"|<button[^>]*id="${id}"[^>]*class="[^"]*app-back-button[^"]*"`)
    );
  }

  const staticCloseButtons = [...index.matchAll(/<button\b[^>]*class="[^"]*close[^"]*"[^>]*>[\s\S]*?<\/button>/gi)];
  assert.ok(staticCloseButtons.length >= 16, 'expected all static modal exits to be present');
  for (const match of staticCloseButtons) {
    assert.match(match[0], /app-back-button/);
    assert.match(match[0], /← Назад/);
    assert.match(match[0], /aria-label="Назад"/);
  }

  assert.match(app, /id="profileSetupClose"[^>]*>[\s\S]*?← Назад<\/button>/);
  assert.match(app, /id="profileSetupBack"[^>]*>[\s\S]*?← Назад<\/button>/);
  assert.match(app, /data-close="animalPickerModal"[^>]*>[\s\S]*?← Назад<\/button>/);

  assert.match(css, /PIVNIK CANONICAL BACK CONTROL/);
  assert.match(css, /\.app-back-button\.hidden\s*\{\s*display:\s*none !important;/);
});

test('canonical back behavior is not blocked by the legacy RED COSMOS history interceptor', async () => {
  const [app, red] = await Promise.all([
    read('app.js'),
    read('red-cosmos-v2.js')
  ]);

  assert.match(
    app,
    /#wheelBackButton'\)\?\.addEventListener\('click', \(\) => window\.__PIVNIK_GO_BACK__\?\.\(\)\)/
  );

  const runStart = red.indexOf('function runEnhancements()');
  const runEnd = red.indexOf('function scheduleEnhancements()', runStart);
  assert.ok(runStart >= 0 && runEnd > runStart);
  const runBody = red.slice(runStart, runEnd);

  assert.doesNotMatch(runBody, /installScreenHistory\(\)/);
  assert.doesNotMatch(runBody, /upgradeBackButtons\(\)/);
});

test('runtime materialization preserves unified Back cache versions', async () => {
  const [index, shell] = await Promise.all([
    read('index.html'),
    read('scripts/apply-red-cosmos-v2-shell-final.mjs')
  ]);

  assert.match(index, /styles\.css\?v=[^"]*unified-back/);
  assert.match(index, /app\.js\?v=[^"]*unified-back/);
  assert.match(shell, /HOME_LEAGUE_STYLE_VERSION[^\n]*unified-back/);
  assert.match(shell, /HOME_WHEEL_APP_VERSION[^\n]*unified-back/);
});
