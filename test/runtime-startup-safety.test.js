import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import test from 'node:test';

const execFile = promisify(execFileCallback);
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

test('Telegram repair bypass exits without invoking fetch in an isolated startup process', async () => {
  const scriptPath = new URL('../scripts/repair-telegram-runtime.mjs', import.meta.url);
  const probe = [
    "globalThis.fetch = async () => { throw new Error('fetch must not be called when bypass is enabled'); };",
    `await import(${JSON.stringify(scriptPath.href)});`
  ].join('\n');

  const { stdout, stderr } = await execFile(process.execPath, ['--input-type=module', '-e', probe], {
    env: {
      ...process.env,
      PIVNIK_SKIP_TELEGRAM_RUNTIME_REPAIR: 'true',
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_APP_URL: 'https://example.invalid'
    }
  });

  assert.match(`${stdout}${stderr}`, /Telegram menu repair skipped because PIVNIK_SKIP_TELEGRAM_RUNTIME_REPAIR=true/);
});

test('Telegram repair fails open when Telegram API is unavailable', async () => {
  const scriptPath = new URL('../scripts/repair-telegram-runtime.mjs', import.meta.url);
  const probe = [
    "let fetchCalls = 0;",
    "globalThis.fetch = async () => { fetchCalls += 1; throw new Error('simulated Telegram outage'); };",
    `await import(${JSON.stringify(scriptPath.href)});`,
    "console.log(`telegram-repair-probe-complete fetchCalls=${fetchCalls}`);"
  ].join('\n');

  const { stdout, stderr } = await execFile(process.execPath, ['--input-type=module', '-e', probe], {
    env: {
      ...process.env,
      PIVNIK_SKIP_TELEGRAM_RUNTIME_REPAIR: 'false',
      PIVNIK_DOCUMENT_PLATFORM: 'telegram',
      RAILWAY_SERVICE_NAME: 'pivnik-bonus-app',
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_APP_URL: 'https://example.invalid'
    },
    timeout: 5000
  });

  const output = `${stdout}${stderr}`;
  assert.match(output, /Telegram bot menu repair failed; application startup will continue: simulated Telegram outage/);
  assert.match(output, /telegram-repair-probe-complete fetchCalls=1/);
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
