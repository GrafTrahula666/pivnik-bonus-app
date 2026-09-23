import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { effectiveRoleForAuthenticatedIdentity } from '../platform-core.js';

const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('shared screen router iterates screen and bottom-nav collections', async () => {
  const app = await read('app.js');
  assert.match(app, /\$\$\('\.screen'\)\.forEach/);
  assert.match(app, /\$\$\('\.bottom-nav \[data-target\]'\)\.forEach/);
  assert.doesNotMatch(app, /(^|[^$])\$\('\.screen'\)\.forEach/m);
  assert.doesNotMatch(app, /(^|[^$])\$\('\.bottom-nav \[data-target\]'\)\.forEach/m);
});

test('configured owner keeps admin access on an already-valid Telegram/VK session', () => {
  assert.equal(
    effectiveRoleForAuthenticatedIdentity('client', 'telegram', '123', { telegram: '123', vk: '456' }),
    'admin'
  );
  assert.equal(
    effectiveRoleForAuthenticatedIdentity('client', 'vk', '456', { telegram: '123', vk: '456' }),
    'admin'
  );
  assert.equal(
    effectiveRoleForAuthenticatedIdentity('staff', 'telegram', '999', { telegram: '123', vk: '456' }),
    'staff'
  );
});

test('gateway and child API derive service role from the validated provider identity', async () => {
  const [gateway, server] = await Promise.all([
    read('universal-server.js'),
    read('server.js')
  ]);

  assert.match(gateway, /effectiveRoleForAuthenticatedIdentity\([\s\S]*?providerUserId[\s\S]*?ownerTelegramId[\s\S]*?ownerVkId/);
  assert.match(gateway, /payload\.profile\.role = user\.role/);
  assert.match(gateway, /if \(!\['viewer', 'admin'\]\.includes\(user\.role\)\)/);
  assert.match(gateway, /if \(!\['staff', 'admin'\]\.includes\(user\.role\)\)/);

  assert.match(server, /process\.env\.OWNER_VK_ID/);
  assert.match(server, /profile\.role = effectiveRoleForAuthenticatedIdentity\(/);
  assert.match(server, /payload\.pid/);
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
