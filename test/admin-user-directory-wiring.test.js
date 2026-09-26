import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('admin CRM users endpoint uses one shared directory query in both server paths', async () => {
  const [server, gateway, directory] = await Promise.all([
    read('server.js'),
    read('universal-server.js'),
    read('admin-user-directory.js')
  ]);

  assert.match(server, /queryAdminUserDirectory\(pool, req\.query\)/);
  assert.match(server, /crmStatus: adminUserCrmStatus\(row\)/);
  assert.match(gateway, /getUnifiedAdminUserDirectory\(url\.searchParams\)/);
  assert.match(gateway, /async function getUnifiedAdminUsers\(\)/);
  assert.match(gateway, /crmStatus: adminUserCrmStatus\(row\)/);

  assert.match(directory, /LIMIT \$\{limitParam\}/);
  assert.match(directory, /OFFSET \$\{offsetParam\}/);
  assert.match(directory, /MAX\(t\.created_at\).*status = 'completed'/s);
  assert.match(directory, /COUNT\(\*\).*status = 'completed'/s);
  assert.doesNotMatch(directory, /\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i);
});

test('admin CRM UI exposes search, role, lifecycle status and bounded pagination', async () => {
  const [html, app, css] = await Promise.all([
    read('index.html'),
    read('app.js'),
    read('styles.css')
  ]);

  for (const id of [
    'userSearch',
    'userRoleFilter',
    'userStatusFilter',
    'adminUsersMeta',
    'adminUsersPrev',
    'adminUsersNext',
    'adminUsersPageLabel'
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }

  assert.match(html, /value="new">Новые · без визитов до 30 дней/);
  assert.match(html, /value="active">Активные · визит до 30 дней/);
  assert.match(html, /value="at_risk">В зоне риска · 30–60 дней/);
  assert.match(html, /value="sleeping">Спящие · более 60 дней/);
  assert.match(html, /value="no_visits">Без визитов · более 30 дней/);
  assert.doesNotMatch(html, /value="inactive">Давно не были/);
  assert.doesNotMatch(html, /value="no_ops">Без операций/);

  assert.match(app, /limit: 25/);
  assert.match(app, /loadAdminUsersDirectory\(1\)/);
  assert.match(app, /adminUsersDirectoryParams/);
  assert.match(app, /userStatusFilter/);
  assert.match(app, /adminUsersPrev/);
  assert.match(app, /adminUsersNext/);
  assert.match(app, /ADMIN_CRM_STATUS_LABELS/);
  assert.match(app, /operationsCount/);
  assert.match(app, /lastActivityAt/);

  assert.match(css, /\.admin-pagination/);
  assert.match(css, /\.crm-user-status\.status-active/);
});

test('dashboard preview keeps a small bounded admin users request', async () => {
  const app = await read('app.js');
  assert.match(app, /api\('\/api\/admin\/users\?limit=5&page=1'\)/);
});
