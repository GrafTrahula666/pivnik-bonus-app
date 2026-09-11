import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const [server, adapter] = await Promise.all([
  fs.readFile(new URL('../server.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../staff-transaction-persistence.js', import.meta.url), 'utf8')
]);

function staffTransactionRouteSource() {
  const startMarker = "app.post('/api/staff/transactions'";
  const endMarker = "app.post('/api/staff/beer-gift'";
  const start = server.indexOf(startMarker);
  const end = server.indexOf(endMarker, start);
  assert.notEqual(start, -1, 'staff transaction route must exist');
  assert.notEqual(end, -1, 'beer-gift route must follow staff transaction route');
  return server.slice(start, end);
}

test('staff transaction route retains the exact direct journal insert before adapter wiring', () => {
  const route = staffTransactionRouteSource();

  assert.match(route, /INSERT INTO transactions \(\s*request_key, client_id, staff_id, mode, status,/s);
  assert.match(route, /VALUES \(\$1,\$2,\$3,\$4,'completed',\$5,\$6,\$7,\$8,\$9,\$10,\$11,\$12,\$13,NOW\(\)\)/s);
  assert.match(route, /RETURNING \*/);
  assert.doesNotMatch(route, /createStaffTransactionPersistence/);
  assert.doesNotMatch(route, /tenantId|locationId|scopedWritesEnabled/);
});

test('staff transaction mutation order remains protected before persistence wiring', () => {
  const route = staffTransactionRouteSource();

  const begin = route.indexOf("await client.query('BEGIN')");
  const requestLock = route.indexOf('await lockRequestKey(client, requestKey)');
  const targetLock = route.indexOf('FOR UPDATE');
  const replay = route.indexOf('SELECT * FROM transactions WHERE request_key = $1');
  const walletLock = route.indexOf('SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE');
  const beerLock = route.indexOf('SELECT paid_ml_total, gift_ml_balance FROM beer_loyalty WHERE user_id = $1 FOR UPDATE');
  const insert = route.indexOf('INSERT INTO transactions (');
  const walletUpdate = route.indexOf("UPDATE wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2");
  const beerUpdate = route.indexOf('UPDATE beer_loyalty SET paid_ml_total = $1, gift_ml_balance = $2, updated_at = NOW() WHERE user_id = $3');
  const commit = route.indexOf("await client.query('COMMIT')", insert);
  const rollback = route.lastIndexOf("await client.query('ROLLBACK')");

  for (const [label, position] of Object.entries({
    begin,
    requestLock,
    targetLock,
    replay,
    walletLock,
    beerLock,
    insert,
    walletUpdate,
    beerUpdate,
    commit,
    rollback
  })) {
    assert.notEqual(position, -1, `${label} must remain present`);
  }

  assert.ok(begin < requestLock, 'BEGIN must precede request-key locking');
  assert.ok(requestLock < targetLock, 'request-key lock must precede target-user lock');
  assert.ok(targetLock < replay, 'target-user lock must precede replay lookup');
  assert.ok(replay < walletLock, 'replay lookup must precede wallet lock');
  assert.ok(walletLock < beerLock, 'wallet lock must precede beer-loyalty lock');
  assert.ok(beerLock < insert, 'all balance inputs must be locked before journal persistence');
  assert.ok(insert < walletUpdate, 'journal insertion must keep its current position before wallet mutation');
  assert.ok(walletUpdate < beerUpdate, 'wallet mutation must precede beer-loyalty mutation');
  assert.ok(beerUpdate < commit, 'all state mutation must complete before COMMIT');
  assert.ok(commit < rollback, 'error rollback path must remain after the success path');
});

test('staff transaction adapter is legacy-by-default and migration-gated', () => {
  assert.match(adapter, /scopedWritesEnabled = false/);
  assert.match(adapter, /requiresMigration009BeforeScopedEnablement: true/);
  assert.match(adapter, /scopedFallbackToLegacy: false/);
  assert.match(adapter, /preservesLegacySqlShape: true/);
  assert.match(adapter, /preservesDatabaseNow: true/);
  assert.match(adapter, /preservesReturningRow: true/);
});
