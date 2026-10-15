import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {createSpaceverseTenantService} from '../spaceverse-tenant-service.js';
import {createSpaceverseRuntimeBundle,assertSpaceverseRuntimeStartAllowed} from '../spaceverse-runtime-manifest.js';
import {verifyRuntimeReadiness,signRuntimeReadiness} from '../spaceverse-runtime-readiness.js';
import {isAutomaticStartupMigration} from '../migration-startup-policy.js';
import {createTenantServiceFixture,telegramCredentials} from '../test-support/spaceverse-tenant-service-fixture.js';

test('manual launch authorization migration is additive/idempotent, contains no permission or customer data and never autostarts',async()=>{
 const f=await createTenantServiceFixture();try{
  const file='022_spaceverse_runtime_launch_authorizations.sql',sql=await fs.readFile(new URL('../migrations/'+file,import.meta.url),'utf8');
  assert.equal(isAutomaticStartupMigration(file),false);assert.doesNotMatch(sql,/^\s*(?:DROP|DELETE|TRUNCATE|INSERT|UPDATE)\b/im);
  await f.db.exec(sql);assert.equal((await f.query('SELECT count(*)::int AS n FROM spaceverse_runtime_launch_authorizations')).rows[0].n,1);
  assert.equal((await f.query('SELECT count(*)::int AS n FROM users')).rows[0].n,0);
 }finally{await f.close();}
});
test('default-off, v2/mutable image, wrong approval and missing credentials cannot open a socket',async()=>{
 const f=await createTenantServiceFixture();try{
  for(const [patch,code] of [
   [{environment:{...f.environment,SPACEVERSE_ENABLE_TENANT_SERVICE:'false'}},'SPACEVERSE_TENANT_SERVICE_DISABLED'],
   [{bundle:createSpaceverseRuntimeBundle(f.manifest,f.bundle.artifact.codeRelease)},'SPACEVERSE_IMAGE_APPROVAL_REQUIRED'],
   [{environment:{...f.environment,SPACEVERSE_RUNTIME_APPROVED_IMAGE_ID:'latest'}},'SPACEVERSE_IMAGE_APPROVAL_MISMATCH'],
   [{environment:{...f.environment,SPACEVERSE_RUNTIME_LAUNCH_KEY:''}},'SPACEVERSE_LAUNCH_CREDENTIALS_REQUIRED'],
  ])await assert.rejects(createSpaceverseTenantService({...f.options,...patch}),{code});
 }finally{await f.close();}
});
test('expired, revoked, foreign-image/bundle and foreign-scope permissions cannot authorize the tenant API',async()=>{
 for(const mutation of [
  "authorized_at=NOW()-INTERVAL '2 hours',expires_at=NOW()-INTERVAL '1 hour'",
  "state='revoked',revoked_at=NOW()",
  "image_id='sha256:"+'2'.repeat(64)+"'",
  "bundle_sha256='"+'b'.repeat(64)+"'",
 ]){
  const f=await createTenantServiceFixture();try{
   await f.query('UPDATE spaceverse_runtime_launch_authorizations SET '+mutation);
   await assert.rejects(createSpaceverseTenantService(f.options),{code:'SPACEVERSE_LAUNCH_AUTHORIZATION_REJECTED'});
  }finally{await f.close();}
 }
 const a=await createTenantServiceFixture(),b=await createTenantServiceFixture({venueId:'702'});try{
  await assert.rejects(createSpaceverseTenantService({...a.options,pool:b.pool}),{code:'SPACEVERSE_RUNTIME_BINDING_MISMATCH'});
 }finally{await a.close();await b.close();}
});
test('real HTTP readiness signs a fresh scope/image/nonce; wrong key, nonce, scope, replay and expired proofs fail',async()=>{
 const f=await createTenantServiceFixture();try{
  const {service,request}=await f.start(),challenge=crypto.randomUUID(),path='/internal/spaceverse/runtime/readiness?challenge='+challenge;
  assert.throws(()=>assertSpaceverseRuntimeStartAllowed(service.runtime),{code:'SPACEVERSE_RUNTIME_NOT_PROVISIONED'});
  assert.equal((await request(path)).status,401);
  assert.equal((await request(path+'&companyId=999',{headers:{'X-Spaceverse-Launch-Key':f.environment.SPACEVERSE_RUNTIME_LAUNCH_KEY}})).status,400);
  const response=await request(path,{headers:{'X-Spaceverse-Launch-Key':f.environment.SPACEVERSE_RUNTIME_LAUNCH_KEY}});
  assert.equal(response.status,200);
  const expected={bundle:f.bundle,authorizationId:f.environment.SPACEVERSE_RUNTIME_LAUNCH_AUTHORIZATION_ID,challenge,key:f.environment.SPACEVERSE_RUNTIME_LAUNCH_KEY};
  assert.equal(verifyRuntimeReadiness(response.body,expected).service.scope,'tenant-api-only');
  assert.doesNotMatch(JSON.stringify(response.body),/svlaunch_|postgres:|session|bot-token/);
  for(const patch of [{challenge:crypto.randomUUID()},{key:'svlaunch_'+'a'.repeat(43)},{now:Date.now()+31_000}])assert.throws(()=>verifyRuntimeReadiness(response.body,{...expected,...patch}),{code:'SPACEVERSE_RUNTIME_READINESS_REJECTED'});
  const {mac,...packet}=response.body;
  const other=signRuntimeReadiness({...packet,runtime:{...packet.runtime,venueId:'999'}},expected.key);
  assert.throws(()=>verifyRuntimeReadiness(other,expected),{code:'SPACEVERSE_RUNTIME_READINESS_REJECTED'});
  const expired=signRuntimeReadiness({...packet,authorization:{...packet.authorization,expiresAt:new Date(Date.now()-1000).toISOString()}},expected.key);
  assert.throws(()=>verifyRuntimeReadiness(expired,expected),{code:'SPACEVERSE_RUNTIME_READINESS_REJECTED'});
  assert.deepEqual((await request('/health')).body,{service:'spaceverse-tenant-api',status:'serving',runtimeStatus:'not_provisioned',published:false});
 }finally{await f.close();}
});
test('native API reuses signed auth/wallet adapters: real zero has data, foreign tenant/venue sessions and scope spoofing fail',async()=>{
 const fixtures=await Promise.all([createTenantServiceFixture(),createTenantServiceFixture({venueId:'702'}),createTenantServiceFixture({companyId:'800',venueId:'801'})]);
 try{
  const servers=await Promise.all(fixtures.map(f=>f.start()));
  const first=await servers[0].request('/api/auth',{method:'POST',body:{requestKey:crypto.randomUUID(),...telegramCredentials()}});
  assert.equal(first.status,200);const token=first.body.token;
  const balance=await servers[0].request('/api/wallet/balance',{token});assert.equal(balance.status,200);assert.equal(balance.body.wallet.balance,'0');assert.equal(balance.body.hasData,true);
  for(const server of servers.slice(1))assert.notEqual((await server.request('/api/wallet/balance',{token})).status,200);
  assert.equal((await servers[0].request('/api/wallet/balance?venueId=999',{token})).status,400);
  assert.equal((await servers[0].request('/api/wallet/balance',{token,headers:{'X-Company-Id':'999'}})).status,400);
  assert.equal((await servers[0].request('/api/device/pos/onboarding/status?challenge='+crypto.randomUUID(),{headers:{'X-Venue-Id':'999'}})).status,400);
  assert.equal((await servers[0].request('/api/wallet/debit',{method:'POST',token,body:{amount:100}})).status,503);
  assert.equal((await servers[0].request('/')).status,404);
  assert.equal((await fixtures[0].query('SELECT count(*)::int AS n FROM users')).rows[0].n,1);
  for(const f of fixtures.slice(1))assert.equal((await f.query('SELECT count(*)::int AS n FROM users')).rows[0].n,0);
 }finally{await Promise.all(fixtures.map(f=>f.close()));}
});
test('revocation closes serving API; a new scoped permission resumes the same customer/wallet without duplicate data',async()=>{
 const f=await createTenantServiceFixture();try{
  const first=await f.start(),login=await first.request('/api/auth',{method:'POST',body:{requestKey:crypto.randomUUID(),...telegramCredentials()}}),token=login.body.token;
  await f.query("UPDATE spaceverse_runtime_launch_authorizations SET state='revoked',revoked_at=NOW()");
  const denied=await first.request('/api/wallet/balance',{token});assert.equal(denied.status,503);assert.equal(denied.body.code,'SPACEVERSE_LAUNCH_AUTHORIZATION_REJECTED');
  await first.service.close();await f.grant();
  const resumed=await f.start(),balance=await resumed.request('/api/wallet/balance',{token});
  assert.equal(balance.status,200);assert.equal(balance.body.wallet.balance,'0');
  assert.equal((await f.query('SELECT count(*)::int AS n FROM users')).rows[0].n,1);
  assert.equal((await f.query('SELECT count(*)::int AS n FROM wallets')).rows[0].n,1);
 }finally{await f.close();}
});
