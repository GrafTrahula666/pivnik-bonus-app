import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const [telegramRepair, retirementAudit, backendPatcher, workingUpdates] = await Promise.all([
  fs.readFile(new URL('../scripts/repair-telegram-runtime.mjs', import.meta.url), 'utf8'),
  fs.readFile(new URL('../scripts/audit-runtime-retirement-candidates.mjs', import.meta.url), 'utf8'),
  fs.readFile(new URL('../scripts/apply-red-cosmos-v2-backend-final.mjs', import.meta.url), 'utf8'),
  fs.readFile(new URL('../scripts/apply-working-updates.mjs', import.meta.url), 'utf8')
]);

test('Telegram startup repair cannot seed or mutate production application data', () => {
  for (const forbidden of [
    "from 'pg'",
    'DATABASE_URL',
    'pivnik_test_client',
    'Тест Пивника',
    'TESTCLIENT20260819PIVNIK',
    'PVK-TEST-2026',
    'INSERT INTO users',
    'INSERT INTO wallets',
    'INSERT INTO beer_loyalty'
  ]) {
    assert.equal(telegramRepair.includes(forbidden), false, `unexpected production startup seed token: ${forbidden}`);
  }

  for (const required of ['deleteWebhook', 'setChatMenuButton', 'deleteMyCommands', 'isVkService']) {
    assert.equal(telegramRepair.includes(required), true, `Telegram repair behavior missing: ${required}`);
  }
});

test('Telegram menu repair is best-effort and cannot block application startup on network failure', () => {
  assert.match(telegramRepair, /try\s*\{/);
  assert.match(telegramRepair, /catch \(error\)/);
  assert.match(telegramRepair, /application startup will continue/);
  assert.doesNotMatch(telegramRepair, /process\.exit\s*\(/);
});

test('Telegram menu repair has an explicit opt-in bypass for isolated DEV diagnostics', () => {
  assert.match(telegramRepair, /PIVNIK_SKIP_TELEGRAM_RUNTIME_REPAIR/);
  assert.match(telegramRepair, /skipRepair/);
  assert.match(telegramRepair, /skipRepair\)\s*\{/);
  assert.match(telegramRepair, /PIVNIK_SKIP_TELEGRAM_RUNTIME_REPAIR=true/);
  assert.doesNotMatch(telegramRepair, /skipRepair\s*=\s*true\s*;/);

  const bypassIndex = telegramRepair.indexOf("if (skipRepair)");
  const apiCallIndex = telegramRepair.indexOf("await telegramApi('deleteWebhook'");
  assert.ok(bypassIndex >= 0, 'explicit bypass branch must exist');
  assert.ok(apiCallIndex > bypassIndex, 'Telegram API calls must remain after the bypass branch');
});

test('Runtime side-effect audit requires a real pg client before classifying DB writes', () => {
  assert.match(retirementAudit, /const databaseClient =/);
  assert.match(retirementAudit, /const databaseMutationSql =/);
  assert.match(retirementAudit, /const databaseWrite = databaseClient && databaseMutationSql;/);
  assert.match(retirementAudit, /unexpectedDatabaseWrites/);

  assert.equal(/\bimport\s+[^;\n]*\s+from\s+['"]pg['"]/i.test(backendPatcher), false);
  assert.equal(/\bimport\s+[^;\n]*\s+from\s+['"]pg['"]/i.test(workingUpdates), false);
  assert.match(backendPatcher, /INSERT INTO transactions|UPDATE shop_items/);
  assert.match(workingUpdates, /UPDATE users/);
});
