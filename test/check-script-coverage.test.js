import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const sources = [
  ...fs.readdirSync(new URL('../', import.meta.url)).filter((name) => name.endsWith('.js')),
  ...fs.readdirSync(new URL('../pos/', import.meta.url)).filter((name) => name.endsWith('.js')).map((name) => `pos/${name}`)
];

test('npm run check covers every root and pos JavaScript source', () => {
  const missing = sources.filter((file) => !pkg.scripts.check.includes(`node --check ${file}`));
  assert.deepEqual(missing, []);
});
