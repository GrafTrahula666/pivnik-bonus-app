// Native PostgreSQL 16 concurrency proof for CHAT 03 / task 24.
// Dedicated disposable database only; no production credentials or migrations.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import { createSpaceverseRuntimeManifest, resolveSpaceverseRuntime } from '../spaceverse-runtime-manifest.js';
import { createSpaceverseManualCrmContactService } from '../crm-manual-contact-create.js';

const connectionString = process.env.SPACEVERSE_CRM_TEST_POSTGRES_URL || '';
const disposable = (() => {
  try {
    const url = new URL(connectionString);
    return ['127.0.0.1','localhost'].includes(url.hostname) &&
      /^codex_admin_test(?:_|$)/.test(decodeURIComponent(url.pathname.slice(1)));
  } catch { return false; }
})();
const native = disposable ? test : test.skip;
const migration = name => new URL('../migrations/' + name, import.meta.url);
const contactMigration = new URL('../admin-platform/tenant-migrations/002_manual_crm_contacts.sql', import.meta.url);
const requestKey = n => `${String(n).padStart(8,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`;
const contact = (key, phone, email) => ({
  requestKey: key,
  contact: {firstName:'Fixture',lastName:'Customer',phone,email}
});

native('native PostgreSQL: concurrent manual contact creation and scoped deduplication', {timeout:90_000}, async () => {
  const admin = new pg.Pool({connectionString,ssl:false,max:1});
  const schema = 'sv_manual_contact_' + crypto.randomBytes(8).toString('hex');
  let db;
  let created = false;
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    created = true;
    db = new pg.Pool({connectionString,ssl:false,max:12,options:'-c search_path=' + schema});
    await db.query('CREATE TABLE users(id BIGSERIAL PRIMARY KEY)');
    for (const name of [
      '017_spaceverse_runtime_binding.sql',
      '018_spaceverse_runtime_scope_binding.sql',
      '019_spaceverse_customer_ownership.sql'
    ]) await db.query(await fs.readFile(migration(name),'utf8'));
    const draftId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const runtimeKey = 'sv-' + 'a'.repeat(32);
    const manifest = createSpaceverseRuntimeManifest({
      draftId,runtimeKey,draftRevision:1,applicationRevision:1,scopeRevision:1,
      scope:{companyId:'50',venueId:'51'},
      config:{displayName:'Native CRM Fixture',theme:'dark',primaryColor:'#112233',
        secondaryColor:'#445566',shopEnabled:false,loyaltyEnabled:false}
    });
    await db.query(`INSERT INTO spaceverse_runtime_binding
      (singleton,runtime_key,manifest_sha256,manifest_revision,company_id,venue_id,isolation_policy,status)
      VALUES(TRUE,$1,$2,1,'50','51','dedicated_database','prepared')`,
      [runtimeKey,manifest.manifestSha256]);
    const migrationClient = await db.connect();
    try {
      await migrationClient.query("SET spaceverse.crm_contacts_migration='approved'");
      await migrationClient.query(await fs.readFile(contactMigration,'utf8'));
    } finally { migrationClient.release(); }
    const runtime = await resolveSpaceverseRuntime({
      environment:{SPACEVERSE_RUNTIME_MODE:'tenant',SPACEVERSE_RUNTIME_MANIFEST_JSON:JSON.stringify(manifest)},
      query:(sql,args)=>db.query(sql,args)
    });
    const service = createSpaceverseManualCrmContactService({
      runtime,actorId:'11',connect:()=>db.connect()
    });

    const replayCommand = contact(requestKey(91),'+79991112233','same@example.invalid');
    const same = await Promise.all(Array.from({length:4},()=>service(replayCommand)));
    assert.equal(new Set(same.map(x=>x.contact.id)).size,1,
      'concurrent identical requests must return the same contact');
    assert.equal(same[0].contact.identityStatus,'unlinked');
    assert.equal(same[0].contact.walletStatus,'not_created');

    const competing = await Promise.allSettled(Array.from({length:4},(_,i)=>
      service(contact(requestKey(100+i),'+79990005544',`unique-${i}@example.invalid`))));
    assert.equal(competing.filter(x=>x.status==='fulfilled').length,1,
      'one normalized phone may belong to only one active contact per venue');
    for (const failure of competing.filter(x=>x.status==='rejected'))
      assert.equal(failure.reason?.code,'SPACEVERSE_CRM_CONTACT_DUPLICATE');

    const counts = await db.query(`SELECT
      (SELECT COUNT(*)::integer FROM spaceverse_crm_contacts) AS contacts,
      (SELECT COUNT(*)::integer FROM spaceverse_crm_contact_create_requests) AS requests,
      (SELECT COUNT(*)::integer FROM users) AS app_users`);
    assert.deepEqual(counts.rows[0],{contacts:2,requests:2,app_users:0});
    const actors = await db.query('SELECT DISTINCT created_by_admin_id::text AS actor FROM spaceverse_crm_contact_create_requests');
    assert.deepEqual(actors.rows,[{actor:'11'}]);
  } finally {
    if(db) await db.end();
    if(created) await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
    await admin.end();
  }
});
