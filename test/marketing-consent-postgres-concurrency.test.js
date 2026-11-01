import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import {createSpaceverseRuntimeManifest,resolveSpaceverseRuntime} from '../spaceverse-runtime-manifest.js';
import {createSpaceverseMarketingConsentReader} from '../marketing-consent-reader.js';
import {createSpaceverseMarketingConsentWriter,MARKETING_CONSENT_LOCK_SQL} from '../marketing-consent-writer.js';

// This NEVER uses the application's production DATABASE_URL.
// Explicitly provision a disposable LOCAL PostgreSQL database named exactly
// spaceverse_chat13_121_test. No server or cloud service is created by the test.
const INPUT_URL=process.env.SPACEVERSE_CONSENT_TEST_DATABASE_URL;
const OPT_IN=process.env.SPACEVERSE_CONSENT_TEST_EXPLICIT_OPT_IN==='yes';
function safeDisposableUrl(input) {
  try {
    const u=new URL(input);
    return (u.protocol==='postgres:'||u.protocol==='postgresql:')
      && ['127.0.0.1','localhost','::1','[::1]'].includes(u.hostname)
      && u.pathname==='/spaceverse_chat13_121_test'
      && !u.search && !u.hash;
  } catch { return false; }
}
const SAFE=OPT_IN&&safeDisposableUrl(INPUT_URL);
const SKIP=!OPT_IN ? 'Explicit disposable Postgres opt-in absent'
  : !SAFE ? 'Unsafe connection target: only localhost/spaceverse_chat13_121_test is permitted'
  : false;
const copies={telegram:{version:'tg_v1',sha256:'a'.repeat(64)},vk:{version:'vk_v1',sha256:'b'.repeat(64)}};
const grant={userId:'11',providerUserId:'1001',channel:'telegram',action:'grant',
  requestId:'grant1',idempotencyKey:'grant1',explicitActionConfirmed:true};
const revoke={...grant,action:'revoke',requestId:'revoke1',idempotencyKey:'revoke1',explicitActionConfirmed:false};
const latch=()=>{
  let resolve;
  const promise=new Promise(r=>{resolve=r;});
  return {promise,resolve};
};

async function withDisposableFixture(callback) {
  const schema='chat13_'+crypto.randomBytes(8).toString('hex');
  const quoted='"'+schema+'"';
  const admin=new pg.Client({connectionString:INPUT_URL,connectionTimeoutMillis:3000});
  await admin.connect();
  let pool;
  try {
    await admin.query('CREATE SCHEMA '+quoted);
    await admin.query('SET search_path TO '+quoted);
    await admin.query("CREATE TABLE users(id BIGINT PRIMARY KEY,role TEXT NOT NULL DEFAULT 'client',deleted_at TIMESTAMPTZ,merged_into_user_id BIGINT); CREATE TABLE user_identities(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),provider TEXT NOT NULL,provider_user_id TEXT NOT NULL,UNIQUE(provider,provider_user_id),UNIQUE(user_id,provider));");
    for (const path of [
      '../migrations/017_spaceverse_runtime_binding.sql',
      '../migrations/018_spaceverse_runtime_scope_binding.sql',
      '../migrations/019_spaceverse_customer_ownership.sql',
      '../ops/sql/CHAT13-121-marketing-consent-manual.sql'
    ]) await admin.query(await fs.readFile(new URL(path,import.meta.url),'utf8'));
    const seed='a';
    const manifest=createSpaceverseRuntimeManifest({
      draftId:seed.repeat(8)+'-'+seed.repeat(4)+'-4'+seed.repeat(3)+'-8'+seed.repeat(3)+'-'+seed.repeat(12),
      runtimeKey:'sv-'+seed.repeat(32),draftRevision:1,applicationRevision:1,scopeRevision:1,
      scope:{companyId:'700',venueId:'701'},
      config:{displayName:'Postgres consent test',theme:'dark',
        primaryColor:'#112233',secondaryColor:'#445566',shopEnabled:true,loyaltyEnabled:true}
    });
    await admin.query("INSERT INTO spaceverse_runtime_binding(singleton,runtime_key,manifest_sha256,manifest_revision,company_id,venue_id,isolation_policy,status) VALUES(TRUE,$1,$2,1,'700','701','dedicated_database','prepared')",
      [manifest.runtimeKey,manifest.manifestSha256]);
    await admin.query("INSERT INTO users(id,role) VALUES(11,'client')");
    await admin.query("INSERT INTO spaceverse_customer_ownership(user_id,runtime_key,company_id,venue_id) VALUES(11,$1,'700','701')",[manifest.runtimeKey]);
    await admin.query("INSERT INTO user_identities(user_id,provider,provider_user_id) VALUES(11,'telegram','1001')");
    pool=new pg.Pool({connectionString:INPUT_URL,options:'-c search_path='+schema,
      max:5,connectionTimeoutMillis:3000,query_timeout:10000});
    const runtime=await resolveSpaceverseRuntime({
      environment:{SPACEVERSE_RUNTIME_MODE:'tenant',
        SPACEVERSE_RUNTIME_MANIFEST_JSON:JSON.stringify(manifest)},
      query:pool.query.bind(pool)
    });
    return await callback({pool,runtime});
  } finally {
    await pool?.end();
    await admin.query('SET search_path TO public').catch(()=>{});
    await admin.query('DROP SCHEMA IF EXISTS '+quoted+' CASCADE').catch(()=>{});
    await admin.end();
  }
}

test('two independent PostgreSQL clients serialize grant then revoke through ownership row lock',
  {skip:SKIP,timeout:30000},async()=>{
  await withDisposableFixture(async({pool,runtime})=>{
    const haveGrantLock=latch(),releaseGrant=latch(),revokeAttempt=latch();
    const grantPool={connect:async()=>{
      const client=await pool.connect();
      return {release:()=>client.release(),query:async(sql,params)=>{
        const result=await client.query(sql,params);
        if (sql===MARKETING_CONSENT_LOCK_SQL) {
          haveGrantLock.resolve();
          await releaseGrant.promise;
        }
        return result;
      }};
    }};
    const revokePool={connect:async()=>{
      const client=await pool.connect();
      return {release:()=>client.release(),query:async(sql,params)=>{
        if (sql===MARKETING_CONSENT_LOCK_SQL) revokeAttempt.resolve();
        return client.query(sql,params);
      }};
    }};
    const grantWriter=createSpaceverseMarketingConsentWriter({runtime,pool:grantPool,approvedCopies:copies});
    const revokeWriter=createSpaceverseMarketingConsentWriter({runtime,pool:revokePool,approvedCopies:copies});
    const grantResult=grantWriter(grant);
    await haveGrantLock.promise; // GRANT holds the real PostgreSQL row lock.
    const revokeResult=revokeWriter(revoke);
    await revokeAttempt.promise; // REVOKE on a separate connection is blocked.
    const pending=await Promise.race([
      revokeResult.then(()=>false,()=>false),
      new Promise(r=>setTimeout(()=>r(true),150))
    ]);
    assert.equal(pending,true,'revoke must wait for the exact customer lock');
    releaseGrant.resolve();
    const [g,r]=await Promise.all([grantResult,revokeResult]);
    assert.equal(g.status,'recorded');
    assert.equal(r.status,'recorded');
    assert.notEqual(g.eventId,r.eventId);

    const reader=createSpaceverseMarketingConsentReader({
      runtime,query:pool.query.bind(pool),approvedCopies:copies
    });
    assert.deepEqual(await reader({userId:'11',channel:'telegram',providerUserId:'1001'}),
      {allowed:false,reason:'consent_revoked'});
    const current=await pool.query("SELECT h.latest_event_id::text AS event_id FROM spaceverse_marketing_consent_heads h WHERE h.user_id=11 AND h.channel='telegram'");
    assert.equal(current.rows[0].event_id,r.eventId);
    const history=await pool.query('SELECT COUNT(*)::int AS n FROM spaceverse_marketing_consent_events');
    assert.equal(history.rows[0].n,2);
  });
});
