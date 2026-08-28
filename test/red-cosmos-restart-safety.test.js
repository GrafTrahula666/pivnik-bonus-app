import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const [runtime, dbPrepare, materializer] = await Promise.all([
  fs.readFile(new URL('../scripts/apply-v22-runtime.mjs', import.meta.url), 'utf8'),
  fs.readFile(new URL('../scripts/red-cosmos-v2-db-prepare.mjs', import.meta.url), 'utf8'),
  fs.readFile(new URL('../scripts/materialize-runtime-patches.mjs', import.meta.url), 'utf8')
]);

test('RED COSMOS skips obsolete v22 assertions after an in-container healthcheck restart', () => {
  assert.match(runtime, /redCosmosAlreadyApplied/);
  assert.match(runtime, /RED_COSMOS_V2_THEME_LOCK/);
  assert.match(runtime, /RED_COSMOS_V2_FINAL_SERVER_RUNTIME/);
  assert.match(runtime, /RED_COSMOS_V2_FINAL_GATEWAY_RUNTIME/);
  assert.match(runtime, /restart-safe legacy v22 skip/);
  const detection = runtime.indexOf('const redCosmosAlreadyApplied');
  const legacyVersionAssertion = runtime.indexOf("APP_VERSION = '22.0-pivnik-rebuild'");
  assert.ok(detection >= 0 && legacyVersionAssertion > detection);
});

test('RED COSMOS DB prepare tolerates Railway private-network warmup and keeps one connection for audit', () => {
  assert.match(dbPrepare, /async function connectWithRetry/);
  assert.match(dbPrepare, /PIVNIK_DB_CONNECT_ATTEMPTS/);
  assert.match(dbPrepare, /PIVNIK_DB_CONNECT_RETRY_MS/);
  assert.match(dbPrepare, /pool\.connect\(\)/);
  assert.match(dbPrepare, /await client\.query\('BEGIN'\)/);
  assert.match(dbPrepare, /await inspectHistoricalSchemas\(client\)/);
});

test('RED COSMOS production DB prepare audits archive schemas without guessing or restoring data', () => {
  assert.match(dbPrepare, /async function inspectHistoricalSchemas/);
  assert.match(dbPrepare, /information_schema\.schemata/);
  assert.match(dbPrepare, /richerSchemas/);
  assert.match(dbPrepare, /TESTER_HANDLES/);
  assert.match(dbPrepare, /drolted/);
  assert.match(dbPrepare, /distraktor/);
  assert.match(dbPrepare, /ksemar/);
  assert.doesNotMatch(dbPrepare, /DROP SCHEMA/);
  assert.doesNotMatch(dbPrepare, /DELETE FROM .*users/i);
});


test('full materialize recognizes the RED COSMOS client version on repeated runs', () => {
  assert.match(materializer, /supportedAppVersion/);
  assert.match(materializer, /19\.1-telegram-wheel-v2/);
  assert.match(materializer, /2\.0-red-cosmos/);
});
