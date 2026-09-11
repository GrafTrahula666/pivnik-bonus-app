import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const [server, adapter] = await Promise.all([
  fs.readFile(new URL('../server.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../beer-gift-transaction-persistence.js', import.meta.url), 'utf8')
]);

function beerGiftRouteSource() {
  const startMarker = "app.post('/api/staff/beer-gift'";
  const endMarker = "app.post('/api/staff/shop/purchase'";
  const start = server.indexOf(startMarker);
  const end = server.indexOf(endMarker, start);
  assert.notEqual(start, -1, 'beer-gift route must exist');
  assert.notEqual(end, -1, 'shop-purchase route must follow beer-gift route');
  return server.slice(start, end);
}

test('beer gift route retains the exact direct journal insert before adapter wiring', () => {
  const route = beerGiftRouteSource();

  assert.match(route, /INSERT INTO transactions \(\s*request_key, client_id, staff_id, mode, status,/s);
  assert.match(route, /VALUES \(\$1,\$2,\$3,'beer_gift','completed',0,0,\$4,\$5,\$6,NOW\(\)\)/s);
  assert.match(route, /RETURNING \*/);
  assert.doesNotMatch(route, /createBeerGiftTransactionPersistence/);
  assert.doesNotMatch(route, /tenantId|locationId|scopedWritesEnabled/);
});

test('beer gift mutation order remains protected before persistence wiring', () => {
  const route = beerGiftRouteSource();

  const begin = route.indexOf("await client.query('BEGIN')");
  const requestLock = route.indexOf('await lockRequestKey(client, requestKey)');
  const targetLock = route.indexOf('FOR UPDATE');
  const replay = route.indexOf('SELECT * FROM transactions WHERE request_key = $1');
  const beerLock = route.indexOf('SELECT paid_ml_total, gift_ml_balance FROM beer_loyalty WHERE user_id = $1 FOR UPDATE');
  const insert = route.indexOf('INSERT INTO transactions (');
  const beerUpdate = route.indexOf('UPDATE beer_loyalty SET gift_ml_balance = $1, updated_at = NOW() WHERE user_id = $2');
  const commit = route.indexOf("await client.query('COMMIT')", insert);
  const rollback = route.lastIndexOf("await client.query('ROLLBACK')");

  for (const [label, position] of Object.entries({
    begin,
    requestLock,
    targetLock,
    replay,
    beerLock,
    insert,
    beerUpdate,
    commit,
    rollback
  })) {
    assert.notEqual(position, -1, `${label} must remain present`);
  }

  assert.ok(begin < requestLock, 'BEGIN must precede request-key locking');
  assert.ok(requestLock < targetLock, 'request-key lock must precede target-user lock');
  assert.ok(targetLock < replay, 'target-user lock must precede replay lookup');
  assert.ok(replay < beerLock, 'replay lookup must precede beer-loyalty lock');
  assert.ok(beerLock < insert, 'gift balance must be locked before journal persistence');
  assert.ok(insert < beerUpdate, 'journal insertion must keep its current position before gift-balance mutation');
  assert.ok(beerUpdate < commit, 'gift-balance mutation must complete before COMMIT');
  assert.ok(commit < rollback, 'error rollback path must remain after the success path');
});

test('beer gift adapter is legacy-by-default and migration-gated', () => {
  assert.match(adapter, /scopedWritesEnabled = false/);
  assert.match(adapter, /requiresMigration009BeforeScopedEnablement: true/);
  assert.match(adapter, /scopedFallbackToLegacy: false/);
  assert.match(adapter, /preservesLegacySqlShape: true/);
  assert.match(adapter, /preservesDatabaseNow: true/);
  assert.match(adapter, /preservesReturningRow: true/);
});
