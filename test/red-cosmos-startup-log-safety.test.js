import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const scriptUrl = new URL('../scripts/red-cosmos-v2-db-prepare.mjs', import.meta.url);

async function readStartupScript() {
  return fs.readFile(scriptUrl, 'utf8');
}

function finalStructuredLogBlock(source) {
  const marker = 'console.log(JSON.stringify({';
  const start = source.lastIndexOf(marker);
  assert.notEqual(start, -1, 'final structured startup log must exist');
  const end = source.indexOf('}));', start);
  assert.notEqual(end, -1, 'final structured startup log must close');
  return source.slice(start, end + 4);
}

test('RED COSMOS production startup log exposes counts only, not DB/user identifiers', async () => {
  const source = await readStartupScript();
  const logBlock = finalStructuredLogBlock(source);

  assert.match(logBlock, /redCosmosDbPrepared:\s*true/);
  assert.match(logBlock, /ownerFramesRestored:\s*ownerFramesRestored\.length/);
  assert.match(logBlock, /testerClaims:\s*testerClaims\.length/);
  assert.match(logBlock, /historicalSchemasInspected:\s*historicalAudit\.summaries\.length/);
  assert.match(logBlock, /historicalRicherSchemasDetected:\s*historicalAudit\.richerSchemas\.length/);

  assert.doesNotMatch(logBlock, /backupSchema|BACKUP_SCHEMA/);
  assert.doesNotMatch(logBlock, /ownerTelegramId|ownerVkId/);
  assert.doesNotMatch(logBlock, /userId|handle|testerHandles/);
  assert.doesNotMatch(logBlock, /historicalAudit\s*[,}]/);
  assert.doesNotMatch(logBlock, /ownerFramesRestored\s*[,}]/);
  assert.doesNotMatch(logBlock, /testerClaims\s*[,}]/);
});

test('RED COSMOS log hardening does not remove backup, reconciliation, or historical audit work', async () => {
  const source = await readStartupScript();

  assert.match(source, /async function createBackup\(/);
  assert.match(source, /await createBackup\(client\)/);
  assert.match(source, /async function reconcileExistingTesterRecipients\(/);
  assert.match(source, /const testerClaims = await reconcileExistingTesterRecipients\(client\)/);
  assert.match(source, /async function inspectHistoricalSchemas\(/);
  assert.match(source, /const historicalAudit = await inspectHistoricalSchemas\(client\)/);
});
