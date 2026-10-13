import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function read(name) {
  return readFile(new URL(name, root), 'utf8');
}

test('canonical shell keeps one stylesheet and never wires legacy visual CSS', async () => {
  const index = await read('index.html');
  assert.match(index, /styles\.css\?v=20\.9-service-entry-canonical-profile-placement-20260925/);
  for (const asset of [
    '/v22.css',
    '/red-cosmos-v2.css',
    '/black-frosted-glass.css',
    '/black-frosted-surfaces.css',
    '/black-frosted-controls.css'
  ]) {
    assert.equal(index.includes(asset), false, `${asset} must not be wired`);
  }
});
