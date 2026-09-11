import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const [server, adapter] = await Promise.all([
  fs.readFile(new URL('../server.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../admin-adjustment-persistence.js', import.meta.url), 'utf8')
]);

function adminAdjustmentRouteSource() {
  const startMarker = "app.post('/api/admin/users/:id/adjust'";
  const endMarker = "app.post('/api/admin/transactions/:id/cancel'";
  const start = server.indexOf(startMarker);
  const end = server.indexOf(endMarker, start);
  assert.notEqual(start, -1, 'admin adjustment route must exist');
  assert.notEqual(end, -1, 'admin transaction-cancel route must follow adjustment route');
  return server.slice(start, end);
}

test('admin adjustment route writes through the migration-gated persistence boundary', () => {
  const route = adminAdjustmentRouteSource();

  assert.match(server, /import \{ createAdminAdjustmentPersistence \} from '\.\/admin-adjustment-persistence\.js';/);
  assert.match(route, /const persistAdjustment = createAdminAdjustmentPersistence\(\{\s*query: client\.query\.bind\(client\)\s*\}\);/s);
  assert.match(route, /await persistAdjustment\(\{\s*transaction:/s);
  assert.match(route, /mode: 'adjustment'/);
  assert.match(route, /status: 'completed'/);
  assert.match(route, /request_key: requestKey/);
  assert.match(route, /client_id: req\.params\.id/);
  assert.match(route, /staff_id: req\.user\.id/);
  assert.doesNotMatch(route, /INSERT INTO transactions/);
  assert.doesNotMatch(route, /tenantId|locationId|scopedWritesEnabled/);
});

test('admin adjustment route keeps transaction, idempotency and row locking around the persistence boundary', () => {
  const route = adminAdjustmentRouteSource();

  const begin = route.indexOf("await client.query('BEGIN')");
  const requestLock = route.indexOf('await lockRequestKey(client, requestKey)');
  const userLock = route.indexOf('FROM users');
  const firstForUpdate = route.indexOf('FOR UPDATE', userLock);
  const walletLock = route.indexOf("SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE");
  const replay = route.indexOf('SELECT * FROM transactions WHERE request_key = $1');
  const walletUpdate = route.indexOf("UPDATE wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2");
  const persistence = route.indexOf('await persistAdjustment({');
  const commit = route.indexOf("await client.query('COMMIT')", persistence);

  for (const [label, position] of Object.entries({
    begin,
    requestLock,
    userLock,
    firstForUpdate,
    walletLock,
    replay,
    walletUpdate,
    persistence,
    commit
  })) {
    assert.notEqual(position, -1, `${label} must remain present`);
  }

  assert.ok(begin < requestLock, 'BEGIN must precede request-key locking');
  assert.ok(requestLock < userLock, 'request-key locking must precede target-user lookup');
  assert.ok(userLock < firstForUpdate, 'target user lookup must retain FOR UPDATE');
  assert.ok(firstForUpdate < walletLock, 'target user must be locked before wallet row');
  assert.ok(walletLock < replay, 'wallet lock must precede idempotent replay lookup');
  assert.ok(replay < walletUpdate, 'replay lookup must precede wallet mutation');
  assert.ok(walletUpdate < persistence, 'wallet update must precede transaction journal persistence');
  assert.ok(persistence < commit, 'transaction journal persistence must complete before COMMIT');
});

test('admin adjustment adapter remains legacy-by-default until migration 009 is deliberately enabled', () => {
  assert.match(adapter, /scopedWritesEnabled = false/);
  assert.match(adapter, /requiresMigration009BeforeScopedEnablement: true/);
  assert.match(adapter, /scopedFallbackToLegacy: false/);
  assert.match(adapter, /preservesLegacySqlShape: true/);
  assert.match(adapter, /preservesDatabaseNow: true/);
});
