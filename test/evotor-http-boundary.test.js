import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import http from 'node:http';
import express from 'express';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { signSession, verifySession, effectiveRoleForAuthenticatedIdentity } from '../platform-core.js';
import { createPosHttp } from '../pos/http.js';
import { importEvotorPage } from '../pos/repository.js';
import { sale } from './fixtures/evotor.js';

// Actual checked-out auth functions and route composition, mounted on loopback.
// Startup, getProfile's unrelated joins and real advisory locks are NOT exercised
// here. SQL is real PostgreSQL/WASM, not mocked financial results. The sync tests
// below use real HTTP against a loopback provider fixture, never live Evotor.
const secret='local-fixture-secret-not-production';
const config={enabled:true,token:'fixture-provider',storeId:'bar'};
const terms='fixture-terms';
const source=async name=>readFile(new URL('../'+name,import.meta.url),'utf8');
function between(text,start,end){const a=text.indexOf(start),b=text.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return text.slice(a,b);}
const token=(id,patch={})=>signSession({uid:String(id),sv:1,platform:'telegram',pid:'tg-'+id,exp:Date.now()+60000,...patch},secret);
async function fixture(){
 const db=new PGlite();
 await db.exec(`CREATE TABLE users(id BIGINT PRIMARY KEY,first_name TEXT,role TEXT,session_version INT DEFAULT 1,terms_accepted_at TIMESTAMPTZ,terms_version TEXT,qr_token TEXT,qr_short_code TEXT,deleted_at TIMESTAMPTZ,merged_into_user_id BIGINT);
 CREATE TABLE qr_aliases(qr_token TEXT,qr_short_code TEXT,user_id BIGINT,source_user_id BIGINT);
 CREATE TABLE user_identities(user_id BIGINT,provider TEXT,provider_user_id TEXT);
 CREATE TABLE wallets(user_id BIGINT,balance BIGINT);CREATE TABLE transactions(id BIGINT,amount BIGINT);
 INSERT INTO users(id,first_name,role,terms_accepted_at,terms_version,qr_short_code) VALUES
 (1,'Client','client',NOW(),'fixture-terms','PVK-AAAA-2222'),(2,'Other','client',NOW(),'fixture-terms','PVK-BBBB-3333'),
 (3,'Admin','admin',NOW(),'fixture-terms',NULL),(4,'Viewer','viewer',NOW(),'fixture-terms',NULL),(5,'No grant','admin',NOW(),'fixture-terms',NULL),(6,'No consent','admin',NULL,NULL,NULL);
 INSERT INTO user_identities SELECT id,'telegram','tg-'||id FROM users;
 INSERT INTO qr_aliases(qr_short_code,user_id,source_user_id) VALUES('PVK-CCCC-4444',1,1);
 INSERT INTO wallets VALUES(1,100);INSERT INTO transactions VALUES(99,123);`);
 for(const file of ['012_evotor_sales.sql','013_evotor_pos_scope_devices.sql'])await db.exec(await source('migrations/'+file));
 await db.exec(`INSERT INTO pos_store_bindings VALUES('bar','tenant-a','loc-a',TRUE),('foreign','tenant-b','loc-b',TRUE);
 INSERT INTO pos_operator_access VALUES(3,'bar',TRUE,NULL),(4,'bar',FALSE,NULL),(6,'bar',TRUE,NULL);`);
 const query=async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.rows.length};};
 const pool={query,connect:async()=>({query,release(){}})};
 await query('BEGIN');await importEvotorPage(pool,'bar',{items:[sale(),sale({id:'anonymous'})]},{until:'2026-10-03T00:00:00Z'});await query('COMMIT');
 return {db,pool};
}
async function mount(kind,pool){
 const pos=createPosHttp(pool,config);
 const globals={pool,Buffer,URL,MAX_BODY_BYTES:8192,verifySession:t=>verifySession(t,secret),effectiveRoleForAuthenticatedIdentity,ownerTelegramId:'fixture-owner',ownerVkId:'fixture-owner-vk',TERMS_VERSION:terms,createPosHttp:()=>pos};
 let server,dropNextLink=false;
 if(kind==='express'){
   const text=await source('server.js'),app=express();app.use(express.json());
   app.use((req,res,next)=>{const json=res.json.bind(res);res.json=payload=>{if(dropNextLink&&req.originalUrl==='/api/admin/pos/link'&&payload.ok){dropNextLink=false;req.socket.destroy();return res;}return json(payload);};next();});
   const getProfile=async(id)=>{const row=(await pool.query('SELECT * FROM users WHERE id=$1',[id])).rows[0];return row&&{id:String(row.id),role:row.role,termsAccepted:Boolean(row.terms_accepted_at&&row.terms_version===terms)};};
   vm.runInNewContext(between(text,'async function authRequired(', '\nfunction requireRole(')+between(text,'const posHttp = createPosHttp(pool);',"\napp.get('/api/admin/summary'")+"\napp.get('/api/staff/fixture',authRequired,(_req,res)=>res.json({ok:true}));",{...globals,app,getProfile});
   app.use((error,_req,res,_next)=>res.status(error.statusCode||500).json({error:error.message}));server=http.createServer(app);
 }else{
   const text=await source('universal-server.js');
   const functions=between(text,'async function canonicalizeSessionToken(', '\nasync function ensurePersonalQr(')+between(text,'async function readRequestBody(', '\nasync function proxyRequest(')+between(text,'function enforceMutationOrigin(', '\nfunction ')+between(text,'function requestAddress(', '\nfunction enforceRateLimit(');
   const routes=between(text,"    if (url.pathname === '/api/device/pos'",'\n    // Available even during DB startup;');
   const context=vm.createContext({...globals,mutationOriginAllowed:()=>false});
   vm.runInContext(functions+'\nthis.originalSendJson=sendJson; this.requireUser=requireGatewayUser;',context);
   context.sendJson=(res,status,payload)=>{if(dropNextLink&&payload.ok){dropNextLink=false;res.destroy();return;}return context.originalSendJson(res,status,payload);};
   context.posHttp=pos;
   vm.runInContext('this.dispatch=async(req,res)=>{const url=new URL(req.url,"http://localhost");enforceMutationOrigin(req);'+routes+'if(url.pathname==="/api/staff/fixture"){await requireGatewayUser(req);return sendJson(res,200,{ok:true});}return sendJson(res,404,{});};',context);
   server=http.createServer((req,res)=>context.dispatch(req,res).catch(e=>context.originalSendJson(res,e.statusCode||500,{error:e.message})));
 }
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {base:`http://127.0.0.1:${server.address().port}`,drop:()=>{dropNextLink=true;},close:()=>new Promise(resolve=>server.close(resolve))};
}
for(const kind of ['express','gateway'])test(`${kind}: real auth and POS routes over HTTP; scope, replay after committed response loss, revocation`,async()=>{
 const {db,pool}=await fixture();const app=await mount(kind,pool);
 try{
  const financialBefore=(await pool.query('SELECT * FROM wallets')).rows;
  const request=async(path,authorization,body)=>{const response=await fetch(app.base+path,{method:body===undefined?'GET':'POST',headers:{...(authorization?{authorization}:{}),'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};};
  const dashboard='/api/admin/pos/dashboard?period=custom&from=2026-10-02&to=2026-10-02';
  for(const credential of ['', 'Bearer forged', 'Bearer '+token(3,{sv:2}), 'Bearer '+token(3,{exp:Date.now()-1000})])assert.equal((await request(dashboard,credential)).status,401);
  assert.equal((await request(dashboard,'Bearer '+token(6))).status,428);
  assert.equal((await request(dashboard,'Bearer '+token(1))).status,403);
  assert.equal((await request(dashboard,'Bearer '+token(5))).status,403);
  assert.equal((await request(dashboard+'&storeId=foreign','Bearer '+token(3))).status,403);
  assert.equal((await request(dashboard+'&tenantId=tenant-b','Bearer '+token(3))).status,403);
  assert.equal((await request(dashboard,'Bearer '+token(4))).status,200);
  const issued=await request('/api/admin/pos/devices','Bearer '+token(3),{storeId:'bar',externalDeviceId:'fixture',label:'Fixture'});assert.equal(issued.status,200);
  const device='Device '+issued.body.deviceToken;
  const resolved=await request('/api/device/pos/qr/resolve',device,{payload:'PVK-AAAA-2222'});assert.equal(resolved.status,200);assert.deepEqual(resolved.body,{client:{id:'1',firstName:'Client'}});assert.equal(resolved.cache,'no-store');
  for(const qr of ['PVK-CCCC-4444','PVK-DDDD-5555'])assert.equal((await request('/api/device/pos/qr/resolve',device,{payload:qr})).status,404);
  assert.equal((await request('/api/device/pos/qr/resolve','Bearer '+token(3),{payload:'PVK-AAAA-2222'})).status,401);
  assert.equal((await request(dashboard,device)).status,401);assert.equal((await request('/api/staff/fixture',device)).status,401);
  assert.equal((await request('/api/device/pos/admin',device,{})).status,404);
  assert.equal((await request('/api/admin/pos/link','Bearer '+token(4),{documentId:'sale-1',qr:'PVK-AAAA-2222'})).status,403);
  app.drop();await assert.rejects(request('/api/admin/pos/link','Bearer '+token(3),{documentId:'sale-1',qr:'PVK-AAAA-2222'}));
  const persisted=(await pool.query('SELECT * FROM pos_customer_links')).rows;
  assert.equal(persisted.length,1);
  const replay=await request('/api/admin/pos/link','Bearer '+token(3),{documentId:'sale-1',qr:'PVK-AAAA-2222'});assert.equal(replay.status,200);
  assert.deepEqual((await pool.query('SELECT * FROM pos_customer_links')).rows,persisted);
  assert.equal((await request('/api/admin/pos/link','Bearer '+token(3),{documentId:'sale-1',qr:'PVK-BBBB-3333'})).status,409);
  const report=await request(dashboard,'Bearer '+token(3));assert.equal(report.status,200);assert.equal(report.body.all.salesCents,'60');assert.equal(report.body.app.salesCents,'30');assert.equal(report.body.unlinked.salesCents,'30');
  assert.deepEqual((await request(dashboard,'Bearer '+token(3))).body,report.body);
  assert.equal((await request('/api/admin/pos/devices/revoke','Bearer '+token(3),{id:issued.body.id})).status,200);
  assert.equal((await request('/api/device/pos/qr/resolve',device,{payload:'PVK-AAAA-2222'})).status,401);
  if(kind==='gateway'){
   assert.equal((await request(dashboard,'Bearer '+token(3,{pid:'wrong-identity'}))).status,401);
   const cross=await fetch(app.base+'/api/device/pos/qr/resolve',{method:'POST',headers:{'sec-fetch-site':'cross-site','content-type':'application/json'},body:'{}'});assert.equal(cross.status,403);
  }
  assert.deepEqual((await pool.query('SELECT * FROM wallets')).rows,financialBefore);assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM transactions')).rows[0].n,1);
 }finally{await app.close();await db.close();}
});

for(const kind of ['express','gateway'])test(`${kind}: malformed provider HTTP preserves cursor and sales; authorized recovery replays safely`,async()=>{
 const {db,pool:basePool}=await fixture();
 const query=async(sql,args)=>sql.includes('pg_try_advisory_lock')?{rows:[{locked:true}]}
   :sql.includes('pg_advisory_unlock')?{rows:[]}:basePool.query(sql,args);
 const pool={query,connect:async()=>({query,release(){}})};
 const app=await mount(kind,pool);
 const nativeFetch=globalThis.fetch;
 let payload=null,providerCalls=0;
 const providerCursors=[];
 const provider=http.createServer((req,res)=>{
   providerCalls++;
   providerCursors.push(new URL(req.url,'http://fixture').searchParams.get('cursor'));
   assert.equal(req.headers.authorization,'Bearer fixture-provider');
   res.setHeader('content-type','application/json');res.end(JSON.stringify(payload));
 });
 await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
 const providerBase=`http://127.0.0.1:${provider.address().port}`;
 globalThis.fetch=(url,options)=>{
   const target=new URL(String(url));
   if(target.origin==='https://api.evotor.ru')return nativeFetch(providerBase+target.pathname+target.search,options);
   return nativeFetch(url,options);
 };
 const request=async(credential,body)=>{
   const response=await nativeFetch(app.base+'/api/admin/pos/sync',{method:'POST',headers:{authorization:credential,'content-type':'application/json'},body:JSON.stringify(body)});
   return {status:response.status,body:await response.json()};
 };
 try{
   await query("UPDATE pos_sync_state SET cursor='resume-page' WHERE store_id='bar'");
   const documents=(await query('SELECT * FROM pos_documents ORDER BY document_id')).rows;
   const progress=(await query('SELECT cursor,scan_until,last_success_at FROM pos_sync_state')).rows;
   const wallets=(await query('SELECT * FROM wallets')).rows;
   const journal=(await query('SELECT * FROM transactions')).rows;
   assert.equal((await request('Bearer forged',{})).status,401);
   assert.equal((await request('Bearer '+token(4),{})).status,403);
   assert.equal((await request('Bearer '+token(3),{storeId:'foreign'})).status,403);
   assert.equal((await request('Bearer '+token(3),{storeId:42})).status,400);
   assert.equal(providerCalls,0);
   for(const invalid of [null,{items:[],paging:[]}]){
     payload=invalid;
     const failed=await request('Bearer '+token(3),{});
     assert.equal(failed.status,502);
     assert.ok(JSON.stringify(failed.body).includes('invalid_response'));
     assert.deepEqual((await query('SELECT * FROM pos_documents ORDER BY document_id')).rows,documents);
     assert.deepEqual((await query('SELECT cursor,scan_until,last_success_at FROM pos_sync_state')).rows,progress);
     const response=await nativeFetch(app.base+'/api/admin/pos/dashboard?period=custom&from=2026-10-02&to=2026-10-02',{headers:{authorization:'Bearer '+token(3)}});
     assert.equal(response.status,200);
     const dashboard=await response.json();
     assert.equal(dashboard.connection.errorCode,'invalid_response');
     assert.equal(dashboard.all.salesCents,'60');
   }
   payload={items:[sale()],paging:{}};
   for(let attempt=0;attempt<2;attempt++){
     const recovered=await request('Bearer '+token(3),{});
     assert.equal(recovered.status,200);assert.equal(recovered.body.complete,true);
   }
   assert.equal(providerCalls,4);
   assert.deepEqual(providerCursors,['resume-page','resume-page','resume-page',null]);
   assert.equal((await query('SELECT COUNT(*)::int AS n FROM pos_documents')).rows[0].n,2);
   const state=(await query('SELECT cursor,last_error_code FROM pos_sync_state')).rows[0];
   assert.equal(state.cursor,null);assert.equal(state.last_error_code,null);
   assert.deepEqual((await query('SELECT * FROM wallets')).rows,wallets);
   assert.deepEqual((await query('SELECT * FROM transactions')).rows,journal);
 }finally{
   globalThis.fetch=nativeFetch;
   provider.closeAllConnections();
   await new Promise(resolve=>provider.close(resolve));
   await app.close();await db.close();
 }
});
