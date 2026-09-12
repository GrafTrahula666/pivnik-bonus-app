import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const [server, adapter] = await Promise.all([
  fs.readFile(new URL('../server.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../shop-purchase-persistence.js', import.meta.url), 'utf8')
]);

function shopRouteSource() {
  const startMarker = "app.post('/api/staff/shop/purchase'";
  const endMarker = "app.get('/api/staff/recent'";
  const start = server.indexOf(startMarker);
  const end = server.indexOf(endMarker, start);
  assert.notEqual(start, -1, 'shop purchase route must exist');
  assert.notEqual(end, -1, 'staff recent route must follow shop purchase route');
  return server.slice(start, end);
}

test('shop purchase route writes through the migration-gated persistence boundary', () => {
  const route = shopRouteSource();

  assert.match(server, /import \{ createShopPurchasePersistence \} from '\.\/shop-purchase-persistence\.js';/);
  assert.match(route, /const persistShopPurchase = createShopPurchasePersistence\(\{\s*query: client\.query\.bind\(client\)\s*\}\);/s);
  assert.match(route, /const shopTransaction = await persistShopPurchase\(\{\s*transaction:/s);
  assert.match(route, /mode: 'shop'/);
  assert.match(route, /status: 'completed'/);
  assert.match(route, /request_key: requestKey/);
  assert.match(route, /client_id: target\.id/);
  assert.match(route, /staff_id: actingStaff\.id/);
  assert.match(route, /bonus_spent: item\.bonusPrice/);
  assert.match(route, /balance_after: balanceAfter/);
  assert.match(route, /reason: item\.title/);
  assert.match(route, /transactionResponse\(shopTransaction\)/);
  assert.doesNotMatch(route, /INSERT INTO transactions/);
  assert.doesNotMatch(route, /tenantId|locationId|scopedWritesEnabled/);
});

test('shop purchase route preserves locks, replay semantics and mutation order around persistence', () => {
  const route = shopRouteSource();

  const begin = route.indexOf("await client.query('BEGIN')");
  const requestLock = route.indexOf('await lockRequestKey(client, requestKey)');
  const itemLock = route.indexOf('FOR SHARE');
  const userLock = route.indexOf('FROM users');
  const userForUpdate = route.indexOf('FOR UPDATE', userLock);
  const replay = route.indexOf('SELECT * FROM transactions WHERE request_key = $1');
  const walletLock = route.indexOf('SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE');
  const persistence = route.indexOf('const shopTransaction = await persistShopPurchase({');
  const walletUpdate = route.indexOf("UPDATE wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2");
  const commit = route.indexOf("await client.query('COMMIT')", persistence);

  for (const [label, position] of Object.entries({
    begin,
    requestLock,
    itemLock,
    userLock,
    userForUpdate,
    replay,
    walletLock,
    persistence,
    walletUpdate,
    commit
  })) {
    assert.notEqual(position, -1, `${label} must remain present`);
  }

  assert.ok(begin < requestLock, 'BEGIN must precede request-key locking');
  assert.ok(requestLock < itemLock, 'request-key lock must precede shop item lock');
  assert.ok(itemLock < userLock, 'shop item must be resolved before target user lock');
  assert.ok(userLock < userForUpdate, 'target user lookup must retain FOR UPDATE');
  assert.ok(userForUpdate < replay, 'target user lock must precede replay lookup');
  assert.ok(replay < walletLock, 'replay lookup must precede wallet lock');
  assert.ok(walletLock < persistence, 'wallet must be locked before transaction journal persistence');
  assert.ok(persistence < walletUpdate, 'transaction journal persistence must keep its original position before wallet mutation');
  assert.ok(walletUpdate < commit, 'wallet mutation must complete before COMMIT');
});

test('shop adapter stays legacy-by-default until migration 009 is deliberately enabled', () => {
  assert.match(adapter, /scopedWritesEnabled = false/);
  assert.match(adapter, /requiresMigration009BeforeScopedEnablement: true/);
  assert.match(adapter, /scopedFallbackToLegacy: false/);
  assert.match(adapter, /preservesLegacySqlShape: true/);
  assert.match(adapter, /preservesDatabaseNow: true/);
  assert.match(adapter, /preservesReturningRow: true/);
});
