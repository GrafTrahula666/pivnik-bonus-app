import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { isAutomaticStartupMigration } from '../migration-startup-policy.js';
import {
  createSpaceverseRuntimeManifest,
  guardSpaceverseRuntimeStartup,
  parseSpaceverseRuntimeManifest,
  resolveSpaceverseRuntime,
  runtimeManifestFromEnvironment,
  SPACEVERSE_RUNTIME_BINDING_SQL
} from '../spaceverse-runtime-manifest.js';

const migrationUrl = new URL('../migrations/017_spaceverse_runtime_binding.sql', import.meta.url);
const appConfig = Object.freeze({
  displayName: 'Бар в Мулино',
  theme: 'premium-dark',
  primaryColor: '#73bcd9',
  secondaryColor: '#172c36',
  shopEnabled: true,
  loyaltyEnabled: true
});

function manifest(draftId, runtimeKey, revision = 1) {
  return createSpaceverseRuntimeManifest({ draftId, runtimeKey, revision, config: appConfig });
}

function environment(value) {
  return {
    SPACEVERSE_RUNTIME_MODE: 'tenant',
    SPACEVERSE_RUNTIME_MANIFEST_JSON: JSON.stringify(value)
  };
}

async function databaseFor(value) {
  const db = new PGlite();
  await db.exec(await fs.readFile(migrationUrl, 'utf8'));
  await db.query(
    `INSERT INTO spaceverse_runtime_binding(
       singleton,runtime_key,manifest_sha256,manifest_revision,isolation_policy,status
     ) VALUES(TRUE,$1,$2,$3,'dedicated_database','prepared')`,
    [value.runtimeKey, value.manifestSha256, value.source.revision]
  );
  return db;
}

test('Business blueprint creates a strict non-secret runtime manifest with a stable checksum', () => {
  const value = manifest(
    '11111111-1111-4111-8111-111111111111',
    'sv-11111111111141118111111111111111'
  );
  assert.deepEqual(parseSpaceverseRuntimeManifest(JSON.stringify(value)), value);
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.application.template, 'standard');
  assert.equal(value.application.qrEnabled, true);
  assert.deepEqual(value.isolation, { policy: 'dedicated_database', legacyDataAccess: false });
  assert.deepEqual(value.release, { runtimeStatus: 'not_provisioned', published: false });
  assert.match(value.manifestSha256, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(value), /token|secret|password|databaseUrl|https?:\/\//i);
});

test('manifest parsing rejects tampering, URLs, tokens and unknown release claims', () => {
  const value = manifest(
    '22222222-2222-4222-8222-222222222222',
    'sv-22222222222242228222222222222222'
  );
  for (const invalid of [
    { ...value, token: 'synthetic-secret' },
    { ...value, application: { ...value.application, logoUrl: 'https://invalid.example/logo' } },
    { ...value, application: { ...value.application, displayName: 'Changed without digest' } },
    { ...value, release: { runtimeStatus: 'ready', published: true } },
    { ...value, manifestSha256: '0'.repeat(64) }
  ]) {
    assert.throws(() => parseSpaceverseRuntimeManifest(invalid), (error) => (
      String(error?.code || '').startsWith('SPACEVERSE_RUNTIME_MANIFEST_')
      && !String(error?.message || '').includes('synthetic-secret')
    ));
  }
});

test('legacy PIVNIK mode remains the default and never queries a runtime binding', async () => {
  let queries = 0;
  const resolved = await resolveSpaceverseRuntime({
    environment: {},
    query: async () => { queries += 1; throw new Error('must not query'); }
  });
  assert.deepEqual(resolved, {
    mode: 'legacy-pivnik', manifest: null, binding: null, startAllowed: true
  });
  assert.equal(queries, 0);
  assert.equal(runtimeManifestFromEnvironment({ SPACEVERSE_RUNTIME_MODE: 'legacy-pivnik' }).mode, 'legacy-pivnik');
});

test('one exact dedicated database binding resolves the manifest but cannot claim publication', async () => {
  const value = manifest(
    '33333333-3333-4333-8333-333333333333',
    'sv-33333333333343338333333333333333',
    2
  );
  const db = await databaseFor(value);
  const calls = [];
  try {
    const resolved = await resolveSpaceverseRuntime({
      environment: environment(value),
      query: async (text, params) => {
        calls.push({ text, params });
        return db.query(text, params);
      }
    });
    assert.equal(resolved.mode, 'tenant');
    assert.equal(resolved.manifest.application.displayName, appConfig.displayName);
    assert.equal(resolved.binding.runtimeKey, value.runtimeKey);
    assert.equal(resolved.binding.manifestRevision, 2);
    assert.equal(resolved.startAllowed, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].text, SPACEVERSE_RUNTIME_BINDING_SQL);
    assert.deepEqual(calls[0].params, [value.runtimeKey]);
    await assert.rejects(
      guardSpaceverseRuntimeStartup({ environment: environment(value), query: db.query.bind(db) }),
      (error) => error?.code === 'SPACEVERSE_RUNTIME_NOT_PROVISIONED'
    );
  } finally { await db.close(); }
});

test('two tenant manifests stay bound to separate databases and cross-binding fails closed', async () => {
  const first = manifest(
    '44444444-4444-4444-8444-444444444444',
    'sv-44444444444444448444444444444444'
  );
  const second = manifest(
    '55555555-5555-4555-8555-555555555555',
    'sv-55555555555545558555555555555555'
  );
  const firstDb = await databaseFor(first);
  const secondDb = await databaseFor(second);
  try {
    assert.equal((await resolveSpaceverseRuntime({ environment: environment(first), query: firstDb.query.bind(firstDb) })).binding.runtimeKey, first.runtimeKey);
    assert.equal((await resolveSpaceverseRuntime({ environment: environment(second), query: secondDb.query.bind(secondDb) })).binding.runtimeKey, second.runtimeKey);
    await assert.rejects(
      resolveSpaceverseRuntime({ environment: environment(second), query: firstDb.query.bind(firstDb) }),
      (error) => error?.code === 'SPACEVERSE_RUNTIME_BINDING_MISMATCH'
    );
    await assert.rejects(
      resolveSpaceverseRuntime({ environment: environment(first), query: secondDb.query.bind(secondDb) }),
      (error) => error?.code === 'SPACEVERSE_RUNTIME_BINDING_MISMATCH'
    );
  } finally {
    await firstDb.close();
    await secondDb.close();
  }
});

test('missing binding schema and incomplete environment fail without database details', async () => {
  const value = manifest(
    '66666666-6666-4666-8666-666666666666',
    'sv-66666666666646668666666666666666'
  );
  const emptyDb = new PGlite();
  try {
    await assert.rejects(
      resolveSpaceverseRuntime({ environment: environment(value), query: emptyDb.query.bind(emptyDb) }),
      (error) => error?.code === 'SPACEVERSE_RUNTIME_BINDING_UNAVAILABLE'
        && !/relation|spaceverse_runtime_binding/i.test(String(error?.message || ''))
    );
    assert.throws(
      () => runtimeManifestFromEnvironment({ SPACEVERSE_RUNTIME_MODE: 'tenant' }),
      (error) => error?.code === 'SPACEVERSE_RUNTIME_MODE_INVALID'
    );
  } finally { await emptyDb.close(); }
});

test('binding migration is additive, manual and creates no application or customer data', async () => {
  const sql = await fs.readFile(migrationUrl, 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS spaceverse_runtime_binding/i);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b/i);
  assert.doesNotMatch(sql, /\bDROP\s+(?:TABLE|COLUMN|SCHEMA|DATABASE)\b/i);
  assert.equal(isAutomaticStartupMigration('017_spaceverse_runtime_binding.sql'), false);
  const db = new PGlite();
  try {
    await db.exec(sql);
    const tables = await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
    assert.deepEqual(tables.rows.map((row) => row.tablename), ['spaceverse_runtime_binding']);
    assert.equal((await db.query('SELECT COUNT(*)::integer AS count FROM spaceverse_runtime_binding')).rows[0].count, 0);
  } finally { await db.close(); }
});

test('both server entrypoints guard before mutation/spawn and VK build receives no server manifest', async () => {
  const [server, gateway, vkBuilder] = await Promise.all([
    fs.readFile(new URL('../server.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../universal-server.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../scripts/build-vk-hosting.mjs', import.meta.url), 'utf8')
  ]);
  assert.ok(server.indexOf('guardSpaceverseRuntimeStartup') < server.indexOf('await initDatabase();'));
  assert.ok(gateway.lastIndexOf('guardSpaceverseRuntimeStartup') < gateway.indexOf('const child = isTestImport'));
  assert.match(server, /SPACEVERSE runtime preflight failed:[\s\S]*error\?\.code/);
  assert.match(gateway, /SPACEVERSE runtime preflight failed:[\s\S]*error\?\.code/);
  assert.doesNotMatch(vkBuilder, /SPACEVERSE_RUNTIME_MANIFEST|manifestSha256|spaceverse_runtime_binding/);
});
