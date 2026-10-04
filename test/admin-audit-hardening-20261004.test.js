import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const read = (path) => fs.readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${startMarker} is missing`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${endMarker} is missing after ${startMarker}`);
  return source.slice(start, end);
}

test('rate limits key on the proxy-appended last X-Forwarded-For hop', async () => {
  const gateway = await read('universal-server.js');
  assert.match(gateway, /x-forwarded-for'\] \|\| ''\)\.split\(','\)\.pop\(\)\.trim\(\)/);
  assert.doesNotMatch(gateway, /x-forwarded-for'\] \|\| ''\)\.split\(','\)\[0\]/);
});

test('staff PIN attempts are also limited per target staff member', async () => {
  const gateway = await read('universal-server.js');
  const activate = sliceBetween(gateway, "url.pathname === '/api/staff/activate'", 'return await proxyRequest');
  assert.match(activate, /enforceRateLimit\(`pin:\$\{user\.id\}/);
  assert.match(activate, /enforceRateLimit\(`pin-target:\$\{targetStaffId\}`, 10, 15 \* 60 \* 1000\)/);
});

test('owner role is protected for both Telegram and VK identities', async () => {
  const server = await read('server.js');
  const handler = sliceBetween(server, "app.post('/api/admin/users/:id/role'", "app.post('/api/admin/users/:id/pin'");
  assert.match(handler, /=== ownerTelegramId/);
  assert.match(handler, /provider = 'vk' AND provider_user_id::text = \$2/);
});

test('design draft rejects non-objects, arrays and oversized payloads', async () => {
  const server = await read('server.js');
  const handler = sliceBetween(server, "app.put('/api/admin/design/draft'", "app.post('/api/admin/design/publish'");
  assert.match(handler, /Array\.isArray\(design\)/);
  assert.match(handler, /JSON\.stringify\(design\)\.length > 50_000/);
});

test('both servers map admin user rows to the same response shape', async () => {
  const normalize = (block) => block.replace(/\s+/g, ' ').trim();
  const server = await read('server.js');
  const gateway = await read('universal-server.js');
  const fromServer = sliceBetween(server, 'users: directory.rows.map((row) => ({', 'pagination: directory.pagination');
  const fromGateway = sliceBetween(gateway, 'users: directory.rows.map((row) => ({', 'pagination: directory.pagination');
  assert.equal(normalize(fromServer), normalize(fromGateway));
});
