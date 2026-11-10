import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL('../' + relativePath, import.meta.url), 'utf8');

test('retired Halloween theme stays disabled while reward frames remain available', async () => {
  const [app, css, index, editor, frames] = await Promise.all([
    read('app.js'),
    read('styles.css'),
    read('index.html'),
    read('admin-platform/src/phaseC/AppContentManagers.tsx'),
    read('personal-profile-frames.js'),
  ]);
  assert.match(app, /classList\.remove\('theme-halloween'\)/);
  assert.doesNotMatch(app, /classList\.toggle\('theme-halloween'/);
  assert.doesNotMatch(app, /\/api\/halloween\//);
  assert.doesNotMatch(css, /html\.theme-halloween\b/);
  assert.doesNotMatch(css, /\/assets\/halloween\//);
  assert.doesNotMatch(index, /data-design-theme="halloween"/);
  assert.doesNotMatch(editor, /Хэллоуин \(ночная\)/);
  assert.match(frames, /'halloween-pumpkin'/);
  await access(new URL('../assets/frames/halloween-pumpkin.png', import.meta.url));
});
