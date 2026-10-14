// Disposable loopback provider/device fixture. Never bootstraps a tenant app or
// contacts a real device; uses the same native handler, binding and SQL as production.
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { resolveSpaceverseRuntime } from '../../../spaceverse-runtime-manifest.js';
import { createSpaceversePosHttp } from '../../../routes/spaceverse-pos.js';

export async function nativePosFixture(manifest,terminalId,storeId) {
 const db=new PGlite(),deviceKey='pvpos_'+crypto.randomBytes(32).toString('base64url'),deviceId=crypto.randomUUID();
 await db.exec('CREATE TABLE users(id BIGINT PRIMARY KEY); CREATE TABLE wallets(user_id BIGINT PRIMARY KEY,balance BIGINT); INSERT INTO users VALUES(1); INSERT INTO wallets VALUES(1,777);');
 for(const file of ['012_evotor_sales.sql','013_evotor_pos_scope_devices.sql','017_spaceverse_runtime_binding.sql','018_spaceverse_runtime_scope_binding.sql','019_spaceverse_customer_ownership.sql','021_spaceverse_pos_test_events.sql'])await db.exec(await fs.readFile(new URL('../../../migrations/'+file,import.meta.url),'utf8'));
 await db.query('INSERT INTO spaceverse_runtime_binding(singleton,runtime_key,manifest_sha256,manifest_revision,company_id,venue_id) VALUES(TRUE,$1,$2,1,$3,$4)',[manifest.runtimeKey,manifest.manifestSha256,manifest.scope.companyId,manifest.scope.venueId]);
 await db.query('INSERT INTO pos_store_bindings(store_id,tenant_id,location_id,enabled) VALUES($1,$2,$3,TRUE)',[storeId,manifest.scope.companyId,manifest.scope.venueId]);
 await db.query("INSERT INTO pos_devices(id,store_id,external_device_id,label,token_hash,created_by) VALUES($1::uuid,$2,$3,'Fixture',$4,1)",[deviceId,storeId,terminalId,crypto.createHash('sha256').update(deviceKey).digest('hex')]);
 const query=(sql,params)=>db.query(sql,params),pool={query,connect:async()=>({query,release(){}})};
 const runtime=await resolveSpaceverseRuntime({environment:{SPACEVERSE_RUNTIME_MODE:'tenant',SPACEVERSE_RUNTIME_MANIFEST_JSON:JSON.stringify(manifest)},query});
 const handler=createSpaceversePosHttp({runtime,pool});
 const server=http.createServer((req,res)=>{void handler(req,res).then(handled=>{if(!handled){res.statusCode=404;res.end();}});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 return {db,origin,deviceId,deviceKey,storeId,terminalId,
  async event(){return fetch(origin+'/api/device/pos/onboarding/event',{method:'POST',headers:{'content-type':'application/json','X-Pivnik-Device-Key':deviceKey},body:JSON.stringify({eventId:crypto.randomUUID(),kind:'onboarding_test'})});},
  async completeSync(){await db.query('INSERT INTO pos_sync_state(store_id,scan_until,last_success_at) VALUES($1,NOW(),NOW()) ON CONFLICT(store_id) DO UPDATE SET scan_until=NOW(),last_success_at=NOW()',[storeId]);},
  async close(){await new Promise(resolve=>server.close(resolve));await db.close();},
 };
}
