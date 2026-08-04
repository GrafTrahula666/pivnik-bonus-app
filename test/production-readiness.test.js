import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { compareReadiness } from '../scripts/verify-unified-production.mjs';

function ready(overrides = {}) {
  return {
    ok: true,
    environment: 'production',
    databaseFingerprint: 'same-db-fingerprint',
    releaseCommit: 'abc123',
    termsVersion: '2026-08-04',
    legalConfigured: true,
    identityTombstoneSecretConfigured: true,
    unifiedAccounts: true,
    ...overrides
  };
}

test('production gate accepts two platforms on the same database and release', () => {
  const result = compareReadiness(ready(), ready());
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test('production gate blocks different databases', () => {
  const result = compareReadiness(
    ready({ databaseFingerprint: 'telegram-db' }),
    ready({ databaseFingerprint: 'vk-db' })
  );
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /different databases/);
});

test('production gate blocks missing legal data and tombstone secret', () => {
  const result = compareReadiness(
    ready(),
    ready({ legalConfigured: false, identityTombstoneSecretConfigured: false })
  );
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /legal configuration/);
  assert.match(result.failures.join('\n'), /IDENTITY_TOMBSTONE_SECRET/);
});

test('materialized gateway exposes safe production readiness metadata', async () => {
  const [gateway, migration, privacy, terms, envExample] = await Promise.all([
    readFile(new URL('../universal-server.js', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/005_runtime_identity.sql', import.meta.url), 'utf8'),
    readFile(new URL('../legal/privacy.html', import.meta.url), 'utf8'),
    readFile(new URL('../legal/terms.html', import.meta.url), 'utf8'),
    readFile(new URL('../.env.example', import.meta.url), 'utf8')
  ]);

  assert.match(gateway, /configuredIdentityTombstoneSecret/);
  assert.match(gateway, /createHmac\('sha256', identityTombstoneSecret\)/);
  assert.match(gateway, /databaseFingerprint/);
  assert.match(gateway, /\/api\/release-readiness/);
  assert.match(gateway, /serveLegalDocument/);
  assert.match(gateway, /refreshDatabaseFingerprint/);
  assert.doesNotMatch(gateway, /createHmac\('sha256', sessionSecret\)[\s\S]{0,120}deleted-identity/);

  assert.match(gateway, /Индивидуальный предприниматель Иживильгин Виталий Викторович/);
  assert.match(gateway, /ИНН 380415014659/);
  assert.match(gateway, /origtopg666@gmail\.com/);
  assert.match(gateway, /г\. Санкт-Петербург, проспект Энгельса, д\. 55/);
  assert.match(gateway, /автоматически перезаписываются не позднее 90 дней/);
  assert.match(gateway, /бухгалтерского и налогового учёта, хранятся 5 лет/);
  assert.match(gateway, /криптографический отпечаток[\s\S]{0,100}хранятся 3 года/);

  assert.match(migration, /runtime_identity/);
  assert.match(migration, /database_instance_id/);
  assert.match(privacy, /\{\{LEGAL_OPERATOR_NAME\}\}/);
  assert.match(terms, /\{\{LEGAL_CONTACT_EMAIL\}\}/);
  assert.match(envExample, /LEGAL_OPERATOR_NAME="Индивидуальный предприниматель Иживильгин Виталий Викторович"/);
  assert.match(envExample, /LEGAL_OPERATOR_ID="ИНН 380415014659"/);
});
