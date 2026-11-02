import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createSpaceverseRuntimeManifest, resolveSpaceverseRuntime } from '../spaceverse-runtime-manifest.js';
import { createSpaceverseMarketingConsentReader, SPACEVERSE_MARKETING_CONSENT_READ_SQL } from '../marketing-consent-reader.js';

const hashes = Object.freeze({ telegram: 'a'.repeat(64), vk: 'b'.repeat(64) });
const copies = Object.freeze({
  telegram: Object.freeze({ version: 'telegram_marketing_v1', sha256: hashes.telegram }),
  vk: Object.freeze({ version: 'vk_marketing_v1', sha256: hashes.vk })
});

async function fixture(seed, companyId, venueId) {
  const db = new PGlite();
  await db.exec(`CREATE TABLE users(id BIGINT PRIMARY KEY,role TEXT NOT NULL DEFAULT 'client',deleted_at TIMESTAMPTZ,merged_into_user_id BIGINT);
    CREATE TABLE user_identities(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),provider TEXT NOT NULL,provider_user_id TEXT NOT NULL,
    UNIQUE(provider,provider_user_id),UNIQUE(user_id,provider));`);
  for (const path of [
    '../migrations/017_spaceverse_runtime_binding.sql',
    '../migrations/018_spaceverse_runtime_scope_binding.sql',
    '../migrations/019_spaceverse_customer_ownership.sql',
    '../ops/sql/CHAT13-121-marketing-consent-manual.sql'
  ]) await db.exec(await fs.readFile(new URL(path, import.meta.url), 'utf8'));

  const manifest = createSpaceverseRuntimeManifest({
    draftId: `${seed.repeat(8)}-${seed.repeat(4)}-4${seed.repeat(3)}-8${seed.repeat(3)}-${seed.repeat(12)}`,
    runtimeKey: `sv-${seed.repeat(32)}`, draftRevision: 1, applicationRevision: 1,
    scopeRevision: 1, scope: { companyId, venueId },
    config: { displayName: `Venue ${venueId}`,theme: 'dark',primaryColor:'#112233',secondaryColor:'#445566',shopEnabled:true,loyaltyEnabled:true }
  });
  await db.query(`INSERT INTO spaceverse_runtime_binding(singleton,runtime_key,manifest_sha256,manifest_revision,company_id,venue_id,isolation_policy,status)
    VALUES(TRUE,$1,$2,1,$3,$4,'dedicated_database','prepared')`,
  [manifest.runtimeKey,manifest.manifestSha256,companyId,venueId]);
  await db.query(`INSERT INTO users(id,role) VALUES(11,'client'),(12,'client')`);
  await db.query(`INSERT INTO spaceverse_customer_ownership(user_id,runtime_key,company_id,venue_id) VALUES(11,$1,$2,$3)`,
    [manifest.runtimeKey,companyId,venueId]);
  await db.query(`INSERT INTO user_identities(user_id,provider,provider_user_id) VALUES(11,'telegram','1001'),(11,'vk','2002'),(12,'telegram','1002')`);
  const runtime=await resolveSpaceverseRuntime({
    environment:{SPACEVERSE_RUNTIME_MODE:'tenant',SPACEVERSE_RUNTIME_MANIFEST_JSON:JSON.stringify(manifest)},
    query:db.query.bind(db)
  });
  return {db,runtime,manifest};
}

async function insertEvent(f, {id, channel, action, providerIdentityId, key}) {
  await f.db.query(`INSERT INTO spaceverse_marketing_consent_events(
    event_id,user_id,runtime_key,company_id,venue_id,channel,purpose,action,
    provider_identity_id,consent_text_version,consent_text_sha256,source_surface,
    authenticated_actor_user_id,explicit_opt_in,request_id,idempotency_key
  ) VALUES($1::uuid,11,$2,$3,$4,$5,'marketing',$6,$7,$8,$9,$10,11,$11,$12,$12)`, [
    id, f.manifest.runtimeKey, f.runtime.context.tenantId, f.runtime.context.locationId,
    channel, action, providerIdentityId,
    action === 'grant' ? copies[channel].version : null,
    action === 'grant' ? copies[channel].sha256 : null,
    channel === 'telegram' ? 'telegram_mini_app' : 'vk_mini_app',
    action === 'grant', key
  ]);
  await f.db.query(`INSERT INTO spaceverse_marketing_consent_heads(user_id,runtime_key,company_id,venue_id,channel,purpose,latest_event_id)
    VALUES(11,$1,$2,$3,$4,'marketing',$5::uuid)
    ON CONFLICT(user_id,runtime_key,company_id,venue_id,channel,purpose)
    DO UPDATE SET latest_event_id=EXCLUDED.latest_event_id`,[
    f.manifest.runtimeKey,f.runtime.context.tenantId,f.runtime.context.locationId,channel,id
  ]);
}

test('read SQL is parameterized, read-only and validates runtime/venue/ownership/current identity', () => {
  assert.match(SPACEVERSE_MARKETING_CONSENT_READ_SQL, /manifest_sha256=\$2/);
  assert.match(SPACEVERSE_MARKETING_CONSENT_READ_SQL, /manifest_revision=\$3/);
  assert.match(SPACEVERSE_MARKETING_CONSENT_READ_SQL, /company_id=\$4 AND venue_id=\$5/);
  assert.match(SPACEVERSE_MARKETING_CONSENT_READ_SQL, /JOIN spaceverse_customer_ownership o/);
  assert.match(SPACEVERSE_MARKETING_CONSENT_READ_SQL, /JOIN user_identities i/);
  assert.match(SPACEVERSE_MARKETING_CONSENT_READ_SQL, /h\.channel=\$7 AND h\.purpose='marketing'/);
  assert.match(SPACEVERSE_MARKETING_CONSENT_READ_SQL, /e\.event_id=h\.latest_event_id/);
  assert.doesNotMatch(SPACEVERSE_MARKETING_CONSENT_READ_SQL, /\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|CREATE|DROP|ALTER)\b/i);
});

test('only a confirmed grant for the current provider identity allows; revocation and other channel deny', async () => {
  const f=await fixture('a','700','701');
  try {
    const read=createSpaceverseMarketingConsentReader({runtime:f.runtime,query:f.db.query.bind(f.db),approvedCopies:copies});
    const tg={userId:'11',channel:'telegram',providerUserId:'1001'};
    assert.equal((await read(tg)).allowed,false);
    assert.equal((await read({userId:'11',channel:'vk',providerUserId:'2002'})).allowed,false);
    assert.equal((await read({userId:'12',channel:'telegram',providerUserId:'1002'})).allowed,false);
    const id=(await f.db.query("SELECT id::text AS id FROM user_identities WHERE user_id=11 AND provider='telegram'")).rows[0].id;
    await insertEvent(f,{id:'11111111-1111-4111-8111-111111111111',channel:'telegram',action:'grant',providerIdentityId:id,key:'grant1'});
    assert.deepEqual(await read(tg),{allowed:true,reason:'consent_proven'});
    assert.equal((await read({userId:'11',channel:'vk',providerUserId:'2002'})).allowed,false);
    assert.equal((await read({userId:'11',channel:'telegram',providerUserId:'9999'})).allowed,false);
    await insertEvent(f,{id:'22222222-2222-4222-8222-222222222222',channel:'telegram',action:'revoke',providerIdentityId:id,key:'revoke1'});
    assert.equal((await read(tg)).reason,'consent_revoked');
  } finally {await f.db.close();}
});

test('different venue DB, stale identity, outdated copy and forged request scope fail closed', async()=>{
  const a=await fixture('b','800','801'),b=await fixture('c','800','802');
  try {
    const tgId=(await a.db.query("SELECT id::text AS id FROM user_identities WHERE user_id=11 AND provider='telegram'")).rows[0].id;
    await insertEvent(a,{id:'33333333-3333-4333-8333-333333333333',channel:'telegram',action:'grant',providerIdentityId:tgId,key:'grant3'});
    const read=createSpaceverseMarketingConsentReader({runtime:a.runtime,query:a.db.query.bind(a.db),approvedCopies:copies});
    assert.equal((await read({userId:'11',channel:'telegram',providerUserId:'1001'})).allowed,true);
    const old={...copies,telegram:{version:'telegram_marketing_v2',sha256:'c'.repeat(64)}};
    const versioned=createSpaceverseMarketingConsentReader({runtime:a.runtime,query:a.db.query.bind(a.db),approvedCopies:old});
    assert.equal((await versioned({userId:'11',channel:'telegram',providerUserId:'1001'})).reason,'consent_text_outdated');
    await a.db.query("DELETE FROM user_identities WHERE user_id=11 AND provider='telegram'");
    await a.db.query("INSERT INTO user_identities(user_id,provider,provider_user_id) VALUES(11,'telegram','1001')");
    assert.equal((await read({userId:'11',channel:'telegram',providerUserId:'1001'})).reason,'identity_changed');
    const cross=createSpaceverseMarketingConsentReader({runtime:b.runtime,query:a.db.query.bind(a.db),approvedCopies:copies});
    assert.equal((await cross({userId:'11',channel:'telegram',providerUserId:'1001'})).allowed,false);
    await assert.rejects(read({userId:'11',channel:'telegram',providerUserId:'1001',tenantId:'800'}),TypeError);
    await assert.rejects(read({userId:'11',channel:'telegram',providerUserId:'1001',venueId:'802'}),TypeError);
  } finally {await a.db.close();await b.db.close();}
});

test('unverified runtime, invalid IDs, malformed or failed DB reads cannot permit marketing', async()=>{
  const f=await fixture('d','900','901');
  try {
    assert.throws(()=>createSpaceverseMarketingConsentReader({runtime:{...f.runtime},query:f.db.query.bind(f.db),approvedCopies:copies}),
      {code:'SPACEVERSE_RUNTIME_CONTEXT_UNVERIFIED'});
    const read=createSpaceverseMarketingConsentReader({runtime:f.runtime,query:async()=>{throw new Error('secret db hostname')},approvedCopies:copies});
    assert.deepEqual(await read({userId:'11',channel:'telegram',providerUserId:'1001'}),{allowed:false,reason:'consent_unavailable'});
    await assert.rejects(read({userId:'-1',channel:'telegram',providerUserId:'1001'}),TypeError);
    await assert.rejects(read({userId:'11',channel:'all',providerUserId:'1001'}),TypeError);
    const malformed=createSpaceverseMarketingConsentReader({runtime:f.runtime,query:async()=>({rows:[{},{}],rowCount:2}),approvedCopies:copies});
    assert.equal((await malformed({userId:'11',channel:'telegram',providerUserId:'1001'})).allowed,false);
  }finally{await f.db.close();}
});
