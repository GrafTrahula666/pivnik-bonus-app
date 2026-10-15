import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs/promises';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { createSpaceverseRuntimeManifest,resolveSpaceverseRuntime } from '../spaceverse-runtime-manifest.js';
import { createSpaceversePosHttp } from '../routes/spaceverse-pos.js';
import { verifyPosOnboardingPacket,signPosOnboardingPacket } from '../pos/onboarding-proxy.js';
import { isAutomaticStartupMigration } from '../migration-startup-policy.js';
const key=()=> 'pvpos_'+crypto.randomBytes(32).toString('base64url');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
async function fixture(seed,companyId,venueId,expressMode=false) {
 const db=new PGlite();
 await db.exec('CREATE TABLE users(id BIGINT PRIMARY KEY); CREATE TABLE wallets(user_id BIGINT PRIMARY KEY,balance BIGINT); INSERT INTO users VALUES(1); INSERT INTO wallets VALUES(1,777);');
 for(const file of ['012_evotor_sales.sql','013_evotor_pos_scope_devices.sql','017_spaceverse_runtime_binding.sql','018_spaceverse_runtime_scope_binding.sql','019_spaceverse_customer_ownership.sql','021_spaceverse_pos_test_events.sql']) await db.exec(await fs.readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const draft=crypto.randomUUID(),runtimeKey='sv-'+seed.repeat(32),storeId='store-'+seed,terminalId='terminal-'+seed;
 const manifest=createSpaceverseRuntimeManifest({draftId:draft,runtimeKey,draftRevision:1,applicationRevision:1,scopeRevision:1,scope:{companyId,venueId},config:{displayName:'Synthetic proxy',theme:'light',primaryColor:'#112233',secondaryColor:'#445566',shopEnabled:false,loyaltyEnabled:true}});
 await db.query('INSERT INTO spaceverse_runtime_binding(singleton,runtime_key,manifest_sha256,manifest_revision,company_id,venue_id) VALUES(TRUE,$1,$2,1,$3,$4)',[runtimeKey,manifest.manifestSha256,companyId,venueId]);
 const deviceKey=key(),deviceId=crypto.randomUUID();
 await db.query('INSERT INTO pos_store_bindings(store_id,tenant_id,location_id,enabled) VALUES($1,$2,$3,TRUE)',[storeId,companyId,venueId]);
 await db.query("INSERT INTO pos_devices(id,store_id,external_device_id,label,token_hash,created_by) VALUES($1::uuid,$2,$3,'Synthetic',$4,1)",[deviceId,storeId,terminalId,hash(deviceKey)]);
 let loseCommit=false;
 const query=async(sql,params)=>{const r=await db.query(sql,params);if(sql==='COMMIT'&&loseCommit){loseCommit=false;throw new Error('Synthetic lost COMMIT response');}return r;};
 const pool={query,connect:async()=>({query,release(){}})};
 const runtime=await resolveSpaceverseRuntime({environment:{SPACEVERSE_RUNTIME_MODE:'tenant',SPACEVERSE_RUNTIME_MANIFEST_JSON:JSON.stringify(manifest)},query});
 const handler=createSpaceversePosHttp({runtime,pool});
 let server;
 if(expressMode) {const app=express();app.use(express.json());app.use((req,res)=>{void handler(req,res).then(handled=>{if(!handled)res.status(404).end();});});server=http.createServer(app);}
 else server=http.createServer((req,res)=>{void handler(req,res).then(handled=>{if(!handled){res.statusCode=404;res.end();}});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const call=async(path,method='GET',body,keyOverride=deviceKey,headers={})=>fetch(origin+path,{method,headers:{'content-type':'application/json','x-pivnik-device-key':keyOverride,...headers},...(body?{body:JSON.stringify(body)}:{})});
 const expected=challenge=>({challenge,runtimeKey,checksum:manifest.manifestSha256,companyId,venueId,storeId,terminalId});
 const status=async()=>{const challenge=crypto.randomUUID(),response=await call('/api/device/pos/onboarding/status?challenge='+challenge);assert.equal(response.status,200);const raw=await response.json();return {raw,packet:verifyPosOnboardingPacket(raw,deviceKey,expected(challenge))};};
 return {db,runtime,handler,call,status,deviceKey,deviceId,storeId,terminalId,manifest,expected,
  loseCommit(){loseCommit=true;},async close(){await new Promise(resolve=>server.close(resolve));await db.close();}};
}

test('manual event migration is not startup policy and does not modify PIVNIK schema',async()=>{
 const sql=await fs.readFile(new URL('../migrations/021_spaceverse_pos_test_events.sql',import.meta.url),'utf8');
 assert.equal(isAutomaticStartupMigration('021_spaceverse_pos_test_events.sql'),false);
 assert.doesNotMatch(sql,/ALTER TABLE\s+(?:users|wallets|purchases)/i);
 assert.doesNotMatch(sql,/(?:^|\n)\s*(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/i);
});
test('real raw/Express HTTP: missing event is distinct from a confirmed empty provider report, with no money writes',async()=>{
 for(const expressMode of [false,true]) {
  const f=await fixture(expressMode?'b':'a','100',expressMode?'102':'101',expressMode);
  try {
   const before=(await f.db.query('SELECT * FROM wallets')).rows;
   const missing=await f.status();assert.equal(missing.packet.lastEvent,null);assert.deepEqual(missing.packet.report,{state:'unavailable',empty:null,period:null});
   const eventId=crypto.randomUUID(),body={eventId,kind:'onboarding_test'};
   const event=await f.call('/api/device/pos/onboarding/event','POST',body);assert.equal(event.status,200);const first=await event.json();
   const retry=await f.call('/api/device/pos/onboarding/event','POST',body);assert.deepEqual(await retry.json(),first);
   await f.db.query('INSERT INTO pos_sync_state(store_id,scan_until,last_success_at) VALUES($1,NOW(),NOW())',[f.storeId]);
   const empty=await f.status();assert.equal(empty.packet.lastEvent.id,eventId);assert.equal(empty.packet.report.state,'available');assert.equal(empty.packet.report.empty,true);
   // A zero-value document is data; availability and connection do not depend on revenue.
   await f.db.query("INSERT INTO pos_documents(source,store_id,document_id,type,closed_at,amount_cents,snapshot) VALUES('evotor',$1,'zero-receipt','SELL',NOW()-INTERVAL '1 minute',0,'{}')",[f.storeId]);
   assert.equal((await f.status()).packet.report.empty,false);
   assert.deepEqual((await f.db.query('SELECT * FROM wallets')).rows,before);
   assert.equal((await f.db.query('SELECT count(*)::int AS n FROM spaceverse_pos_test_events')).rows[0].n,1);
   assert.equal(empty.packet.runtime.status,'not_provisioned');
   assert.equal(JSON.stringify(empty.raw).includes(f.deviceKey),false);
  }finally{await f.close();}
 }
});
test('two tenants/two venues: database, device and current runtime scope are rechecked in SQL',async()=>{
 const a=await fixture('c','100','101'),b=await fixture('d','100','102'),c=await fixture('e','200','201');
 try {
  for(const other of [b,c]) {
   const response=await other.call('/api/device/pos/onboarding/status?challenge='+crypto.randomUUID(),'GET',undefined,a.deviceKey);
   assert.equal(response.status,401);assert.equal((await other.db.query('SELECT count(*)::int AS n FROM spaceverse_pos_test_events')).rows[0].n,0);
  }
  const foreignKey=key();
  await a.db.query("INSERT INTO pos_store_bindings(store_id,tenant_id,location_id,enabled) VALUES('foreign','100','102',TRUE)");
  await a.db.query("INSERT INTO pos_devices(id,store_id,external_device_id,label,token_hash,created_by) VALUES($1::uuid,'foreign','foreign-terminal','Foreign',$2,1)",[crypto.randomUUID(),hash(foreignKey)]);
  assert.equal((await a.call('/api/device/pos/onboarding/status?challenge='+crypto.randomUUID(),'GET',undefined,foreignKey)).status,401);
  assert.throws(()=>createSpaceversePosHttp({runtime:{...a.runtime},pool:{}}),{code:'SPACEVERSE_RUNTIME_CONTEXT_UNVERIFIED'});
  await a.db.query("UPDATE spaceverse_runtime_binding SET manifest_sha256=$1",['f'.repeat(64)]);
  assert.equal((await a.call('/api/device/pos/onboarding/status?challenge='+crypto.randomUUID())).status,503);
 }finally{await Promise.all([a.close(),b.close(),c.close()]);}
});
test('strict v2 input rejects scope substitution, legacy Authorization fallback, bad MAC and stale challenge',async()=>{
 const f=await fixture('f','300','301');
 try {
  assert.equal((await f.call('/api/device/pos/onboarding/status?challenge='+crypto.randomUUID(),'GET',undefined,'',{'authorization':'Device '+f.deviceKey})).status,401);
  assert.equal((await f.call('/api/device/pos/onboarding/status?challenge='+crypto.randomUUID()+'&companyId=999')).status,400);
  assert.equal((await f.call('/api/device/pos/onboarding/status?challenge='+crypto.randomUUID(),'GET',undefined,f.deviceKey,{'x-company-id':'999'})).status,400);
  assert.equal((await f.call('/api/device/pos/onboarding/event','POST',{eventId:crypto.randomUUID(),kind:'onboarding_test',tenantId:'999'})).status,400);
  const {raw}=await f.status();assert.throws(()=>verifyPosOnboardingPacket({...raw,mac:'x'.repeat(43)},f.deviceKey,f.expected(raw.challenge)));
  assert.throws(()=>verifyPosOnboardingPacket(raw,f.deviceKey,f.expected(crypto.randomUUID())));
  const altered={...raw,runtime:{...raw.runtime,venueId:'999'}};const {mac,...packet}=altered;altered.mac=signPosOnboardingPacket(packet,f.deviceKey);
  assert.throws(()=>verifyPosOnboardingPacket(altered,f.deviceKey,f.expected(raw.challenge)));
  assert.throws(()=>verifyPosOnboardingPacket(raw,f.deviceKey,f.expected(raw.challenge),Date.now()+31_000));
  // Property order can change in a proxy; canonical MAC stays valid.
  const shuffled=Object.fromEntries(Object.entries(raw).reverse());assert.doesNotThrow(()=>verifyPosOnboardingPacket(shuffled,f.deviceKey,f.expected(raw.challenge)));
 }finally{await f.close();}
});
test('lost COMMIT retry keeps the same event and cannot refresh its server activity time',async()=>{
 const f=await fixture('9','400','401');
 try {
  const body={eventId:crypto.randomUUID(),kind:'onboarding_test'};f.loseCommit();
  assert.equal((await f.call('/api/device/pos/onboarding/event','POST',body)).status,503);
  const stored=(await f.db.query('SELECT received_at::text FROM spaceverse_pos_test_events')).rows[0].received_at;
  assert.equal((await f.call('/api/device/pos/onboarding/event','POST',body)).status,200);
  assert.equal((await f.db.query('SELECT received_at::text FROM spaceverse_pos_test_events')).rows[0].received_at,stored);
  await f.db.query('UPDATE pos_devices SET revoked_at=NOW() WHERE id=$1::uuid',[f.deviceId]);
  assert.equal((await f.call('/api/device/pos/onboarding/event','POST',body)).status,401);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM spaceverse_pos_test_events')).rows[0].n,1);
 }finally{await f.close();}
});
