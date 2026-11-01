import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {createSpaceverseRuntimeManifest,resolveSpaceverseRuntime} from '../spaceverse-runtime-manifest.js';
import {createSpaceverseMarketingConsentReader} from '../marketing-consent-reader.js';
import {
  createSpaceverseMarketingConsentWriter, MARKETING_CONSENT_LOCK_SQL,
  MARKETING_CONSENT_APPEND_SQL, MARKETING_CONSENT_HEAD_SQL
} from '../marketing-consent-writer.js';

const copies={telegram:{version:'tg_v1',sha256:'a'.repeat(64)},vk:{version:'vk_v1',sha256:'b'.repeat(64)}};
const base={userId:'11',providerUserId:'1001',channel:'telegram',action:'grant',
  requestId:'req_1',idempotencyKey:'idem_1',explicitActionConfirmed:true};

async function fixture(seed='a',companyId='700',venueId='701') {
  const db=new PGlite();
  await db.exec("CREATE TABLE users(id BIGINT PRIMARY KEY,role TEXT NOT NULL DEFAULT 'client',deleted_at TIMESTAMPTZ,merged_into_user_id BIGINT); CREATE TABLE user_identities(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),provider TEXT NOT NULL,provider_user_id TEXT NOT NULL,UNIQUE(provider,provider_user_id),UNIQUE(user_id,provider));");
  for (const path of [
    '../migrations/017_spaceverse_runtime_binding.sql',
    '../migrations/018_spaceverse_runtime_scope_binding.sql',
    '../migrations/019_spaceverse_customer_ownership.sql',
    '../ops/sql/CHAT13-121-marketing-consent-manual.sql'
  ]) await db.exec(await fs.readFile(new URL(path,import.meta.url),'utf8'));
  const manifest=createSpaceverseRuntimeManifest({
    draftId:seed.repeat(8)+'-'+seed.repeat(4)+'-4'+seed.repeat(3)+'-8'+seed.repeat(3)+'-'+seed.repeat(12),
    runtimeKey:'sv-'+seed.repeat(32),draftRevision:1,applicationRevision:1,scopeRevision:1,
    scope:{companyId,venueId},
    config:{displayName:'Marketing test',theme:'dark',primaryColor:'#112233',
      secondaryColor:'#445566',shopEnabled:true,loyaltyEnabled:true}
  });
  await db.query("INSERT INTO spaceverse_runtime_binding(singleton,runtime_key,manifest_sha256,manifest_revision,company_id,venue_id,isolation_policy,status) VALUES(TRUE,$1,$2,1,$3,$4,'dedicated_database','prepared')",
    [manifest.runtimeKey,manifest.manifestSha256,companyId,venueId]);
  await db.query("INSERT INTO users(id,role) VALUES(11,'client'),(12,'client')");
  await db.query('INSERT INTO spaceverse_customer_ownership(user_id,runtime_key,company_id,venue_id) VALUES(11,$1,$2,$3)',
    [manifest.runtimeKey,companyId,venueId]);
  await db.query("INSERT INTO user_identities(user_id,provider,provider_user_id) VALUES(11,'telegram','1001'),(11,'vk','2002'),(12,'telegram','1002')");
  const runtime=await resolveSpaceverseRuntime({
    environment:{SPACEVERSE_RUNTIME_MODE:'tenant',SPACEVERSE_RUNTIME_MANIFEST_JSON:JSON.stringify(manifest)},
    query:db.query.bind(db)
  });
  const pool={connect:async()=>({query:db.query.bind(db),release(){}})};
  return {db,runtime,pool};
}

test('writer scopes, locks ownership and uses only a one-connection transaction',()=>{
  assert.match(MARKETING_CONSENT_LOCK_SQL,/FOR UPDATE OF o/);
  assert.match(MARKETING_CONSENT_LOCK_SQL,/manifest_sha256=\$2/);
  assert.match(MARKETING_CONSENT_LOCK_SQL,/company_id=\$4 AND b.venue_id=\$5/);
  assert.match(MARKETING_CONSENT_LOCK_SQL,/JOIN spaceverse_customer_ownership o/);
  assert.match(MARKETING_CONSENT_LOCK_SQL,/JOIN user_identities i/);
  assert.match(MARKETING_CONSENT_APPEND_SQL,/INSERT INTO spaceverse_marketing_consent_events/);
  assert.match(MARKETING_CONSENT_HEAD_SQL,/ON CONFLICT\(user_id,runtime_key,company_id,venue_id,channel,purpose\)/);
});

test('grant permits exact identity, revoke denies, other channel remains denied',async()=>{
  const f=await fixture();
  try {
    const writer=createSpaceverseMarketingConsentWriter({runtime:f.runtime,pool:f.pool,approvedCopies:copies});
    const reader=createSpaceverseMarketingConsentReader({runtime:f.runtime,query:f.db.query.bind(f.db),approvedCopies:copies});
    const request={userId:'11',channel:'telegram',providerUserId:'1001'};
    assert.equal((await reader(request)).allowed,false);
    const grant=await writer(base);
    assert.equal(grant.status,'recorded');
    assert.equal((await reader(request)).allowed,true);
    assert.equal((await reader({userId:'11',channel:'vk',providerUserId:'2002'})).allowed,false);
    const revoked=await writer({...base,action:'revoke',requestId:'req_2',
      idempotencyKey:'idem_2',explicitActionConfirmed:false});
    assert.notEqual(revoked.eventId,grant.eventId);
    assert.equal((await reader(request)).reason,'consent_revoked');
    const count=await f.db.query('SELECT COUNT(*)::int AS n FROM spaceverse_marketing_consent_events');
    assert.equal(count.rows[0].n,2);
    const head=await f.db.query("SELECT latest_event_id::text AS id FROM spaceverse_marketing_consent_heads WHERE channel='telegram'");
    assert.equal(head.rows[0].id,revoked.eventId);
  }finally{await f.db.close();}
});

test('identical replay never writes twice; conflicting reuse of key fails',async()=>{
  const f=await fixture('b','800','801');
  try {
    const writer=createSpaceverseMarketingConsentWriter({runtime:f.runtime,pool:f.pool,approvedCopies:copies});
    const first=await writer(base);
    assert.deepEqual(await writer(base),{status:'replayed',eventId:first.eventId});
    await assert.rejects(writer({...base,requestId:'changed'}),{code:'CONSENT_IDEMPOTENCY_CONFLICT'});
    await assert.rejects(writer({...base,action:'revoke'}),{code:'CONSENT_IDEMPOTENCY_CONFLICT'});
    const n=await f.db.query('SELECT COUNT(*)::int AS n FROM spaceverse_marketing_consent_events');
    assert.equal(n.rows[0].n,1);
  }finally{await f.db.close();}
});

test('no explicit grant, foreign customer, wrong identity or forged scope is denied',async()=>{
  const f=await fixture('c','900','901');
  try {
    const writer=createSpaceverseMarketingConsentWriter({runtime:f.runtime,pool:f.pool,approvedCopies:copies});
    await assert.rejects(writer({...base,explicitActionConfirmed:false}),{code:'CONSENT_EXPLICIT_ACTION_REQUIRED'});
    await assert.rejects(writer({...base,userId:'12',providerUserId:'1002'}),{code:'CONSENT_SCOPE_DENIED'});
    await assert.rejects(writer({...base,providerUserId:'1002'}),{code:'CONSENT_SCOPE_DENIED'});
    await assert.rejects(writer({...base,tenantId:'other'}),TypeError);
    await assert.rejects(writer({...base,channel:'all'}),TypeError);
    const n=await f.db.query('SELECT COUNT(*)::int AS n FROM spaceverse_marketing_consent_events');
    assert.equal(n.rows[0].n,0);
  }finally{await f.db.close();}
});

test('failed head update rolls back append and hides underlying DB details',async()=>{
  const f=await fixture('d','999','998');
  try {
    const faultyPool={connect:async()=>({
      query:async(sql,params)=>{
        if (sql===MARKETING_CONSENT_HEAD_SQL) throw new Error('secret SQL connection string');
        return f.db.query(sql,params);
      },
      release(){}
    })};
    const writer=createSpaceverseMarketingConsentWriter({runtime:f.runtime,pool:faultyPool,approvedCopies:copies});
    await assert.rejects(writer(base),err=>err.code==='CONSENT_RECORD_UNAVAILABLE'
      && !err.message.includes('secret'));
    const n=await f.db.query('SELECT COUNT(*)::int AS n FROM spaceverse_marketing_consent_events');
    assert.equal(n.rows[0].n,0);
  }finally{await f.db.close();}
});

test('tenant runtime for a different venue cannot write into this database',async()=>{
  const a=await fixture('e','800','801');
  const b=await fixture('f','800','802');
  try {
    const writer=createSpaceverseMarketingConsentWriter({runtime:b.runtime,pool:a.pool,approvedCopies:copies});
    await assert.rejects(writer(base),{code:'CONSENT_SCOPE_DENIED'});
    const n=await a.db.query('SELECT COUNT(*)::int AS n FROM spaceverse_marketing_consent_events');
    assert.equal(n.rows[0].n,0);
  }finally{await a.db.close();await b.db.close();}
});

test('audit rows cannot be altered after consent was recorded',async()=>{
  const f=await fixture('1','1000','1001');
  try {
    const writer=createSpaceverseMarketingConsentWriter({runtime:f.runtime,pool:f.pool,approvedCopies:copies});
    const result=await writer(base);
    await assert.rejects(f.db.query('UPDATE spaceverse_marketing_consent_events SET action=$1 WHERE event_id=$2::uuid',
      ['revoke',result.eventId]));
    await assert.rejects(f.db.query('DELETE FROM spaceverse_marketing_consent_events WHERE event_id=$1::uuid',
      [result.eventId]));
  }finally{await f.db.close();}
});
