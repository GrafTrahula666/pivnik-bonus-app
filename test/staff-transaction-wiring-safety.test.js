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

test('staff transaction route writes through the migration-gated persistence boundary', () => {
  const route = staffTransactionRouteSource();
  assert.match(server, /import \{ createStaffTransactionPersistence \} from '\.\/staff-transaction-persistence\.js';/);
  assert.match(route, /createStaffTransactionPersistence\(\{/);
  assert.match(route, /await persistStaffTransaction\(\{/);
  assert.match(route, /const tx = persistedTransaction;/);
  assert.doesNotMatch(route, /INSERT INTO transactions/);
  assert.doesNotMatch(route, /tenantId|locationId|scopedWritesEnabled/);
});

test('staff transaction mutation order remains protected around persistence wiring', () => {
  const route = staffTransactionRouteSource();
  const begin = route.indexOf("await client.query('BEGIN')");
  const requestLock = route.indexOf('await lockRequestKey(client, requestKey)');
  const targetLock = route.indexOf('FOR UPDATE');
  const replay = route.indexOf('SELECT * FROM transactions WHERE request_key = $1');
  const walletLock = route.indexOf('SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE');
  const beerLock = route.indexOf('SELECT paid_ml_total, gift_ml_balance FROM beer_loyalty WHERE user_id = $1 FOR UPDATE');
  const persistence = route.indexOf('await persistStaffTransaction({');
  const walletUpdate = route.indexOf("UPDATE wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2");
  const beerUpdate = route.indexOf('UPDATE beer_loyalty SET paid_ml_total = $1, gift_ml_balance = $2, updated_at = NOW() WHERE user_id = $3');
  const commit = route.indexOf("await client.query('COMMIT')", persistence);
  const rollback = route.lastIndexOf("await client.query('ROLLBACK')");

  for (const [label, position] of Object.entries({ begin, requestLock, targetLock, replay, walletLock, beerLock, persistence, walletUpdate, beerUpdate, commit, rollback })) {
    assert.notEqual(position, -1, `${label} must remain present`);
  }
  assert.ok(begin < requestLock);
  assert.ok(requestLock < targetLock);
  assert.ok(targetLock < replay);
  assert.ok(replay < walletLock);
  assert.ok(walletLock < beerLock);
  assert.ok(beerLock < persistence);
  assert.ok(persistence < walletUpdate);
  assert.ok(walletUpdate < beerUpdate);
  assert.ok(beerUpdate < commit);
  assert.ok(commit < rollback);
});

test('staff transaction adapter is legacy-by-default and migration-gated', () => {
  assert.match(adapter, /scopedWritesEnabled = false/);
  assert.match(adapter, /requiresMigration009BeforeScopedEnablement: true/);
  assert.match(adapter, /scopedFallbackToLegacy: false/);
  assert.match(adapter, /preservesLegacySqlShape: true/);
  assert.match(adapter, /preservesDatabaseNow: true/);
  assert.match(adapter, /preservesReturningRow: true/);
  assert.match(adapter, /acceptsPostgresBigintStrings: true/);
});
