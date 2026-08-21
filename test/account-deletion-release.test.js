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
  const nextRoute = gateway.indexOf('\n    if (req.method', routeStart + 1);
  assert.ok(nextRoute > routeStart);
  const route = gateway.slice(routeStart, nextRoute);
  assert.match(route, /platformFromRequest\(req, user\.payload\.platform \|\| 'unknown'\)/);
  assert.match(route, /deletePlatformAccount\(user\.id, platform, user\.payload\.pid, body\.confirmation\)/);
  assert.doesNotMatch(route, /termsAccepted/);
  assert.doesNotMatch(route, /deleteUnifiedAccount/);
});

test('Удаление старой связки затрагивает только текущую платформу', async () => {
  const gateway = await source('universal-server.js');
  const functionStart = gateway.indexOf('async function deletePlatformAccount(');
  const functionEnd = gateway.indexOf('async function getUnifiedAdminUsers()', functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  const deletion = gateway.slice(functionStart, functionEnd);

  assert.match(deletion, /providerUserId/);
  assert.match(deletion, /remainingIdentities\.length/);
  assert.match(deletion, /preservedOtherPlatform: true/);
  assert.match(deletion, /DELETE FROM user_identities[\s\S]*provider = \$2[\s\S]*provider_user_id = \$3/);
  assert.match(deletion, /INSERT INTO deleted_identity_tombstones/);
  assert.match(deletion, /session_version = session_version \+ 1/);
  assert.doesNotMatch(deletion, /DELETE FROM wallets[\s\S]{0,300}preservedOtherPlatform: true/);
});

test('Последняя identity удаляет весь профиль и сохраняет только keyed hash', async () => {
  const [gateway, migration] = await Promise.all([
    source('universal-server.js'),
    source('migrations/004_deleted_identity_tombstones.sql')
  ]);

  assert.match(migration, /deleted_identity_tombstones/);
  assert.match(migration, /identity_hash TEXT NOT NULL/);
  assert.doesNotMatch(migration, /provider_user_id/);
  assert.match(gateway, /function deletedIdentityHash/);
  assert.match(gateway, /configuredIdentityTombstoneSecret/);
  assert.match(gateway, /createHmac\('sha256', identityTombstoneSecret\)/);

  const hashStart = gateway.indexOf('function deletedIdentityHash');
  const hashEnd = gateway.indexOf('async function hasDeletedIdentity', hashStart);
  assert.ok(hashStart >= 0 && hashEnd > hashStart);
  assert.doesNotMatch(gateway.slice(hashStart, hashEnd), /sessionSecret/);

  assert.match(gateway, /const rewardEligible = !\(await hasDeletedIdentity/);
  assert.match(gateway, /initializeAchievementGrants/);
  assert.doesNotMatch(gateway, /betaNumber > 0 && betaNumber <= 30/);
  assert.match(gateway, /INSERT INTO deleted_identity_tombstones/);
  assert.match(gateway, /DELETE FROM user_identities/);
  assert.ok(
    gateway.indexOf('INSERT INTO deleted_identity_tombstones')
      < gateway.indexOf('DELETE FROM user_identities')
  );
  assert.match(gateway, /preservedOtherPlatform: false/);
  assert.match(gateway, /DELETE FROM wallets/);
});
