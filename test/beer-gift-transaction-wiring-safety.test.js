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

test('beer gift route writes through the migration-gated persistence boundary', () => {
  const route = beerGiftRouteSource();
  assert.match(server, /import \{ createBeerGiftTransactionPersistence \} from '\.\/beer-gift-transaction-persistence\.js';/);
  assert.match(route, /createBeerGiftTransactionPersistence\(\{/);
  assert.match(route, /await persistBeerGiftTransaction\(\{/);
  assert.match(route, /transactionResponse\(beerGiftTransaction\)/);
  assert.doesNotMatch(route, /INSERT INTO transactions/);
  assert.doesNotMatch(route, /tenantId|locationId|scopedWritesEnabled/);
});

test('beer gift mutation order remains protected around persistence wiring', () => {
  const route = beerGiftRouteSource();
  const begin = route.indexOf("await client.query('BEGIN')");
  const requestLock = route.indexOf('await lockRequestKey(client, requestKey)');
  const targetLock = route.indexOf('FOR UPDATE');
  const replay = route.indexOf('SELECT * FROM transactions WHERE request_key = $1');
  const beerLock = route.indexOf('SELECT paid_ml_total, gift_ml_balance FROM beer_loyalty WHERE user_id = $1 FOR UPDATE');
  const persistence = route.indexOf('await persistBeerGiftTransaction({');
  const beerUpdate = route.indexOf('UPDATE beer_loyalty SET gift_ml_balance = $1, updated_at = NOW() WHERE user_id = $2');
  const commit = route.indexOf("await client.query('COMMIT')", persistence);
  const rollback = route.lastIndexOf("await client.query('ROLLBACK')");

  for (const [label, position] of Object.entries({ begin, requestLock, targetLock, replay, beerLock, persistence, beerUpdate, commit, rollback })) {
    assert.notEqual(position, -1, `${label} must remain present`);
  }
  assert.ok(begin < requestLock);
  assert.ok(requestLock < targetLock);
  assert.ok(targetLock < replay);
  assert.ok(replay < beerLock);
  assert.ok(beerLock < persistence);
  assert.ok(persistence < beerUpdate);
  assert.ok(beerUpdate < commit);
  assert.ok(commit < rollback);
});

test('beer gift adapter is legacy-by-default and migration-gated', () => {
  assert.match(adapter, /scopedWritesEnabled = false/);
  assert.match(adapter, /requiresMigration009BeforeScopedEnablement: true/);
  assert.match(adapter, /scopedFallbackToLegacy: false/);
  assert.match(adapter, /preservesLegacySqlShape: true/);
  assert.match(adapter, /preservesDatabaseNow: true/);
  assert.match(adapter, /preservesReturningRow: true/);
  assert.match(adapter, /acceptsPostgresBigintStrings: true/);
});
