import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../scripts/railway-cross-platform-e2e.mjs', import.meta.url),
  'utf8'
);

test('Production cross-platform E2E is guarded and always rolls back', () => {
  assert.match(source, /E2E_ROLLBACK_ONLY_20260804/);
  assert.match(source, /BEGIN ISOLATION LEVEL SERIALIZABLE/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /finally\s*\{[\s\S]*ROLLBACK/);
  assert.doesNotMatch(source, /client\.query\(['"]COMMIT['"]\)/);
  assert.match(source, /productionDataPersisted:\s*false/);
  assert.match(source, /Rollback verification failed/);
});

test('Production cross-platform E2E covers account merge and both directions', () => {
  assert.match(source, /mergeUsers/);
  assert.match(source, /same canonical profile/i);
  assert.match(source, /VK-side accrual was not visible through the Telegram identity/);
  assert.match(source, /Telegram-side redemption was not visible through the VK identity/);
  assert.match(source, /SAVEPOINT duplicate_request/);
  assert.match(source, /Duplicate transaction request key was not blocked/);
  assert.match(source, /achievementPreserved:\s*true/);
});

test('Production cross-platform E2E uses Railway public database access without logging secrets', () => {
  assert.match(source, /DATABASE_PUBLIC_URL/);
  assert.match(source, /canonicalInternalUrl/);
  assert.match(source, /sha256\(telegramDatabaseUrl\)/);
  assert.match(source, /sha256\(vkDatabaseUrl\)/);
  assert.doesNotMatch(source, /console\.log\([^\n]*(DATABASE_URL|SESSION_SECRET|RAILWAY_API_TOKEN)/);
});
