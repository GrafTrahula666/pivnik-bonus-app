import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const names = (file) => new Set(
  fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
    .filter(Boolean)
);

test('env.example and .env.example declare the same variables', () => {
  const dotted = names('.env.example');
  const plain = names('env.example');
  assert.deepEqual([...dotted].filter((name) => !plain.has(name)), []);
  assert.deepEqual([...plain].filter((name) => !dotted.has(name)), []);
});
