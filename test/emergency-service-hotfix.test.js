import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('emergency Home service entry mirrors canonical role-gated controls', async () => {
  const [index, hotfix] = await Promise.all([
    read('index.html'),
    read('emergency-service-hotfix.js')
  ]);
  assert.match(index, /emergency-service-hotfix\.css\?v=1\.0\.0/);
  assert.match(index, /emergency-service-hotfix\.js\?v=1\.0\.0/);
  assert.match(hotfix, /profileStaffNav/);
  assert.match(hotfix, /profileAdminNav/);
  assert.match(hotfix, /classList\.contains\('hidden'\)/);
  assert.match(hotfix, /profileStaff\.click\(\)/);
  assert.match(hotfix, /profileAdmin\.click\(\)/);
  assert.doesNotMatch(hotfix, /role\s*=|\/api\/admin\/users\/:id\/role|fetch\(/);
});

test('emergency hotfix removes the white Telegram header without changing app background', async () => {
  const [index, hotfix] = await Promise.all([
    read('index.html'),
    read('emergency-service-hotfix.js')
  ]);
  assert.match(index, /meta name="theme-color" content="#0b0e13"/);
  assert.match(hotfix, /setHeaderColor\?\.\(DARK_HEADER\)/);
  assert.doesNotMatch(hotfix, /setBackgroundColor/);
});
