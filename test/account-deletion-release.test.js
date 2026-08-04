import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('Удаление доступно без принятия правил и требует явного подтверждения', async () => {
  const [app, index, gateway] = await Promise.all([
    source('app.js'),
    source('index.html'),
    source('universal-server.js')
  ]);

  assert.match(index, /id="deleteAccountFromConsent"/);
  assert.match(index, /id="deleteAccountConfirm"/);
  assert.match(index, /id="deleteAccountButton"[^>]*disabled/);
  assert.match(app, /consentSafeTarget/);
  assert.match(app, /deleteAccountFromConsent/);

  const routeStart = gateway.indexOf("req.method === 'DELETE' && url.pathname === '/api/me/account'");
  assert.ok(routeStart >= 0);
  const route = gateway.slice(routeStart, routeStart + 700);
  assert.match(route, /deleteUnifiedAccount\(user\.id, body\.confirmation\)/);
  assert.doesNotMatch(route, /termsAccepted/);
});

test('Удалённая platform identity хранится только как keyed hash и блокирует повторные награды', async () => {
  const [gateway, migration] = await Promise.all([
    source('universal-server.js'),
    source('migrations/004_deleted_identity_tombstones.sql')
  ]);

  assert.match(migration, /deleted_identity_tombstones/);
  assert.match(migration, /identity_hash TEXT NOT NULL/);
  assert.doesNotMatch(migration, /provider_user_id/);
  assert.match(gateway, /function deletedIdentityHash/);
  assert.match(gateway, /createHmac\('sha256', sessionSecret\)/);
  assert.match(gateway, /const rewardEligible = !\(await hasDeletedIdentity/);
  assert.match(gateway, /if \(rewardEligible && betaNumber > 0 && betaNumber <= 30\)/);
  assert.match(gateway, /INSERT INTO deleted_identity_tombstones/);
  assert.match(gateway, /DELETE FROM user_identities/);
  assert.ok(
    gateway.indexOf('INSERT INTO deleted_identity_tombstones')
      < gateway.indexOf('DELETE FROM user_identities')
  );
});
