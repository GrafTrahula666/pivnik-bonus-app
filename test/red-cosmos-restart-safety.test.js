import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const [runtime, dbPrepare] = await Promise.all([
  fs.readFile(new URL('../scripts/apply-v22-runtime.mjs', import.meta.url), 'utf8'),
  fs.readFile(new URL('../scripts/red-cosmos-v2-db-prepare.mjs', import.meta.url), 'utf8')
]);

test('RED COSMOS skips obsolete v22 assertions after an in-container healthcheck restart', () => {
  assert.match(runtime, /redCosmosAlreadyApplied/);
  assert.match(runtime, /RED_COSMOS_V2_THEME_LOCK/);
  assert.match(runtime, /RED_COSMOS_V2_FINAL_SERVER_RUNTIME/);
  assert.match(runtime, /RED_COSMOS_V2_FINAL_GATEWAY_RUNTIME/);
  assert.match(runtime, /restart-safe legacy v22 skip/);
  const detection = runtime.indexOf('const redCosmosAlreadyApplied');
  const legacyVersionAssertion = runtime.indexOf("APP_VERSION = '22.0-pivnik-rebuild'");
  assert.ok(detection >= 0 && legacyVersionAssertion > detection, 'RED COSMOS detection must run before legacy v22 assertions');
});

test('RED COSMOS DB prepare tolerates Railway private-network warmup and keeps one connection for audit', () => {
  assert.match(dbPrepare, /async function connectWithRetry/);
  assert.match(dbPrepare, /connectionTimeoutMillis: 8_000/);
  assert.match(dbPrepare, /RED COSMOS DB connection attempt/);
  assert.match(dbPrepare, /const client = await connectWithRetry\(\)/);
  assert.match(dbPrepare, /const audit = await client\.query/);
  assert.doesNotMatch(dbPrepare, /const audit = await pool\.query/);
});
