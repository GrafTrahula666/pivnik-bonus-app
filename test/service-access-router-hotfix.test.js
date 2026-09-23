import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('shared screen router iterates screen and bottom-nav collections', async () => {
  const app = await read('app.js');
  assert.match(app, /\$\$\('\.screen'\)\.forEach/);
  assert.match(app, /\$\$\('\.bottom-nav \[data-target\]'\)\.forEach/);
  assert.doesNotMatch(app, /(^|[^$])\$\('\.screen'\)\.forEach/m);
  assert.doesNotMatch(app, /(^|[^$])\$\('\.bottom-nav \[data-target\]'\)\.forEach/m);
});

test('configured owner profile exposes effective admin role', async () => {
  const server = await read('universal-server.js');
  assert.match(server, /role: isOwnerRow\(row\) \? 'admin' : row\.role/);
});

test('service entrypoints remain present and cache-busted', async () => {
  const index = await read('index.html');
  assert.match(index, /id="profileServiceAccess"/);
  assert.match(index, /id="profileStaffNav"/);
  assert.match(index, /id="profileAdminNav"/);
  assert.match(index, /data-screen="staff"/);
  assert.match(index, /data-screen="admin"/);
  assert.match(index, /app\.js\?v=20\.4-home-v2-precision-polish/);
});
