import fs from 'node:fs/promises';

const testPath = new URL('../test/source-invariants.test.js', import.meta.url);
const source = await fs.readFile(testPath, 'utf8');
const before = "  assert.match(server, /request_key, client_id, staff_id, mode/);";
const after = [
  "  assert.match(server, /createStaffTransactionPersistence/);",
  "  assert.match(server, /createBeerGiftTransactionPersistence/);",
  "  assert.match(server, /request_key: requestKey/);",
  "  assert.doesNotMatch(server.slice(server.indexOf(\"app.post('/api/staff/transactions'\"), server.indexOf(\"app.post('/api/staff/shop/purchase'\")), /INSERT INTO transactions/);"
].join('\n');

const first = source.indexOf(before);
if (first < 0) throw new Error('stale transaction source invariant not found');
if (source.indexOf(before, first + before.length) >= 0) throw new Error('stale transaction source invariant is not unique');
await fs.writeFile(testPath, source.slice(0, first) + after + source.slice(first + before.length), 'utf8');
console.log('Transaction source invariant now follows persistence boundaries instead of raw route SQL.');
