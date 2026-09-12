import fs from 'node:fs/promises';

const serverPath = new URL('../server.js', import.meta.url);
const staffWiringTestPath = new URL('../test/staff-transaction-wiring-safety.test.js', import.meta.url);
const beerWiringTestPath = new URL('../test/beer-gift-transaction-wiring-safety.test.js', import.meta.url);
const staffPersistenceTestPath = new URL('../test/staff-transaction-persistence.test.js', import.meta.url);
const beerPersistenceTestPath = new URL('../test/beer-gift-transaction-persistence.test.js', import.meta.url);

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: expected source not found`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${label}: expected source is not unique`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceWithinRoute(source, startMarker, endMarker, before, after, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`${label}: route boundaries not found`);
  const route = source.slice(start, end);
  const replaced = replaceOnce(route, before, after, label);
  return source.slice(0, start) + replaced + source.slice(end);
}

let server = await fs.readFile(serverPath, 'utf8');
server = replaceOnce(
  server,
  "import { createShopPurchasePersistence } from './shop-purchase-persistence.js';\n",
  "import { createShopPurchasePersistence } from './shop-purchase-persistence.js';\nimport { createStaffTransactionPersistence } from './staff-transaction-persistence.js';\nimport { createBeerGiftTransactionPersistence } from './beer-gift-transaction-persistence.js';\n",
  'persistence imports'
);

const staffDirectInsert = `    const txResult = await client.query(\n      \`INSERT INTO transactions (\n         request_key, client_id, staff_id, mode, status,\n         check_amount_cents, discount_cents, bonus_spent, bonus_earned,\n         cash_paid_cents, balance_after, is_suspicious,\n         beer_ml, beer_gift_earned_ml, completed_at\n       ) VALUES ($1,$2,$3,$4,'completed',$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())\n       RETURNING *\`,\n      [requestKey, targetUser.id, actingStaff.id, mode, amountCents, discountCents, bonusSpent, bonusEarned, cashPaidCents, balanceAfter, isSuspicious, beerMl, beerGiftEarnedMl]\n    );`;

const staffBoundaryInsert = `    const persistStaffTransaction = createStaffTransactionPersistence({\n      query: client.query.bind(client)\n    });\n    const persistedTransaction = await persistStaffTransaction({\n      transaction: {\n        request_key: requestKey,\n        client_id: targetUser.id,\n        staff_id: actingStaff.id,\n        mode,\n        status: 'completed',\n        check_amount_cents: amountCents,\n        discount_cents: discountCents,\n        bonus_spent: bonusSpent,\n        bonus_earned: bonusEarned,\n        cash_paid_cents: cashPaidCents,\n        balance_after: balanceAfter,\n        is_suspicious: isSuspicious,\n        beer_ml: beerMl,\n        beer_gift_earned_ml: beerGiftEarnedMl\n      }\n    });`;

server = replaceWithinRoute(
  server,
  "app.post('/api/staff/transactions'",
  "app.post('/api/staff/beer-gift'",
  staffDirectInsert,
  staffBoundaryInsert,
  'staff transaction journal wiring'
);
server = replaceWithinRoute(
  server,
  "app.post('/api/staff/transactions'",
  "app.post('/api/staff/beer-gift'",
  '    const tx = txResult.rows[0];',
  '    const tx = persistedTransaction;',
  'staff transaction response wiring'
);

const beerDirectInsert = `    const txResult = await client.query(\n      \`INSERT INTO transactions (\n         request_key, client_id, staff_id, mode, status,\n         check_amount_cents, cash_paid_cents, balance_after,\n         beer_gift_spent_ml, reason, completed_at\n       ) VALUES ($1,$2,$3,'beer_gift','completed',0,0,$4,$5,$6,NOW())\n       RETURNING *\`,\n      [requestKey, targetUser.id, actingStaff.id, Number(walletResult.rows[0]?.balance || 0), giftMl, \`Выдан подарочный объём \${litersFromMl(giftMl)} л\`]\n    );`;

const beerBoundaryInsert = `    const persistBeerGiftTransaction = createBeerGiftTransactionPersistence({\n      query: client.query.bind(client)\n    });\n    const beerGiftTransaction = await persistBeerGiftTransaction({\n      transaction: {\n        request_key: requestKey,\n        client_id: targetUser.id,\n        staff_id: actingStaff.id,\n        mode: 'beer_gift',\n        status: 'completed',\n        check_amount_cents: 0,\n        cash_paid_cents: 0,\n        balance_after: Number(walletResult.rows[0]?.balance || 0),\n        beer_gift_spent_ml: giftMl,\n        reason: \`Выдан подарочный объём \${litersFromMl(giftMl)} л\`\n      }\n    });`;

server = replaceWithinRoute(
  server,
  "app.post('/api/staff/beer-gift'",
  "app.post('/api/staff/shop/purchase'",
  beerDirectInsert,
  beerBoundaryInsert,
  'beer gift journal wiring'
);
server = replaceWithinRoute(
  server,
  "app.post('/api/staff/beer-gift'",
  "app.post('/api/staff/shop/purchase'",
  'transactionResponse(txResult.rows[0])',
  'transactionResponse(beerGiftTransaction)',
  'beer gift response wiring'
);
await fs.writeFile(serverPath, server, 'utf8');

await fs.writeFile(staffWiringTestPath, `import assert from 'node:assert/strict';
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
  assert.match(server, /import \\{ createStaffTransactionPersistence \\} from '\\.\\/staff-transaction-persistence\\.js';/);
  assert.match(route, /createStaffTransactionPersistence\\(\\{/);
  assert.match(route, /await persistStaffTransaction\\(\\{/);
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
    assert.notEqual(position, -1, \`\${label} must remain present\`);
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
`, 'utf8');

await fs.writeFile(beerWiringTestPath, `import assert from 'node:assert/strict';
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
  assert.match(server, /import \\{ createBeerGiftTransactionPersistence \\} from '\\.\\/beer-gift-transaction-persistence\\.js';/);
  assert.match(route, /createBeerGiftTransactionPersistence\\(\\{/);
  assert.match(route, /await persistBeerGiftTransaction\\(\\{/);
  assert.match(route, /transactionResponse\\(beerGiftTransaction\\)/);
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
    assert.notEqual(position, -1, \`\${label} must remain present\`);
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
`, 'utf8');

let staffPersistenceTest = await fs.readFile(staffPersistenceTestPath, 'utf8');
staffPersistenceTest = staffPersistenceTest
  .replaceAll('/client_id must be a positive safe integer/', '/client_id must be a positive database identifier/')
  .replaceAll('/staff_id must be a positive safe integer/', '/staff_id must be a positive database identifier/');
staffPersistenceTest = replaceOnce(
  staffPersistenceTest,
  "test('staff adapter rejects identity states the endpoint cannot produce before SQL', async () => {",
  `test('staff adapter accepts PostgreSQL bigint IDs as decimal strings', async () => {\n  const calls = [];\n  const persist = createStaffTransactionPersistence({\n    query: async (sql, values) => {\n      calls.push({ sql, values });\n      return { rows: [{ id: 95 }] };\n    }\n  });\n\n  await persist({ transaction: staffTransaction({ client_id: '9223372036854775806', staff_id: '21' }) });\n  assert.equal(calls[0].values[1], '9223372036854775806');\n  assert.equal(calls[0].values[2], '21');\n});\n\ntest('staff adapter rejects identity states the endpoint cannot produce before SQL', async () => {`,
  'staff bigint regression insertion'
);
staffPersistenceTest = replaceOnce(
  staffPersistenceTest,
  '  assert.equal(staffTransactionPersistenceContract.preservesReturningRow, true);',
  '  assert.equal(staffTransactionPersistenceContract.preservesReturningRow, true);\n  assert.equal(staffTransactionPersistenceContract.acceptsPostgresBigintStrings, true);',
  'staff bigint contract assertion'
);
await fs.writeFile(staffPersistenceTestPath, staffPersistenceTest, 'utf8');

let beerPersistenceTest = await fs.readFile(beerPersistenceTestPath, 'utf8');
beerPersistenceTest = beerPersistenceTest
  .replaceAll('/positive safe integer client_id/', '/positive database identifier client_id/')
  .replaceAll('/positive safe integer staff_id/', '/positive database identifier staff_id/');
beerPersistenceTest = replaceOnce(
  beerPersistenceTest,
  "test('beer gift adapter enforces gift invariants before SQL in legacy mode', async () => {",
  `test('beer gift adapter accepts PostgreSQL bigint IDs as decimal strings', async () => {\n  const calls = [];\n  const persist = createBeerGiftTransactionPersistence({\n    query: async (sql, values) => {\n      calls.push({ sql, values });\n      return { rows: [{ id: 96 }] };\n    }\n  });\n\n  await persist({ transaction: beerGiftTransaction({ client_id: '9223372036854775806', staff_id: '21' }) });\n  assert.equal(calls[0].values[1], '9223372036854775806');\n  assert.equal(calls[0].values[2], '21');\n});\n\ntest('beer gift adapter enforces gift invariants before SQL in legacy mode', async () => {`,
  'beer bigint regression insertion'
);
beerPersistenceTest = replaceOnce(
  beerPersistenceTest,
  '  assert.equal(beerGiftTransactionPersistenceContract.preservesReturningRow, true);',
  '  assert.equal(beerGiftTransactionPersistenceContract.preservesReturningRow, true);\n  assert.equal(beerGiftTransactionPersistenceContract.acceptsPostgresBigintStrings, true);',
  'beer bigint contract assertion'
);
await fs.writeFile(beerPersistenceTestPath, beerPersistenceTest, 'utf8');

console.log('Critical staff and beer-gift persistence wiring applied with PostgreSQL bigint compatibility coverage.');
