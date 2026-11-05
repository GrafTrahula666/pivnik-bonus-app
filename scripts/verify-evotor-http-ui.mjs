// Manual composition diagnostic. Pinned draft, disposable DB, loopback HTTP only.
// Pass absolute external Playwright module and Chromium executable as arguments.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const pin='776c70d691540b01bbc56a1496203e6cc918eea6';
const files=['pos/analytics.js','pos/evotor-client.js','pos/evotor-document.js','pos/repository.js','pos/service.js','pos/sync.js','qr-resolver.js','platform-core.js','migrations/012_evotor_sales.sql','test/fixtures/evotor.js','pos-admin.js','pos-admin.css'];
const root=path.resolve(new URL('../',import.meta.url).pathname),scratch=await mkdtemp(path.join(tmpdir(),'evotor-http-'));
const nativeFetch=globalThis.fetch,hashes={},cases=[];let browser,server,db,service,origin,actor,providerStatus=200,providerCalls=0,posts=0,releaseProvider,holdProvider=false,linkPosts=0,holdLink=false,releaseLink,failLinkInsert=false,truncateLinkReply=false;const linkBodies=[],recoveryEvidence=[];
const config={enabled:true,token:'local-fixture-only',storeId:'bar'};
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
 assert.ok(process.argv[2]&&process.argv[3],'External browser paths required; no installation');
 await writeFile(path.join(scratch,'package.json'),' {"type":"module"}');
 for(const file of files){const bytes=execFileSync('git',['show',`${pin}:${file}`],{cwd:root,maxBuffer:2e6});hashes[file]=createHash('sha256').update(bytes).digest('hex');await mkdir(path.dirname(path.join(scratch,file)),{recursive:true});await writeFile(path.join(scratch,file),bytes);}
 const {createPosService}=await import(pathToFileURL(path.join(scratch,'pos/service.js')));
 const {sale}=await import(pathToFileURL(path.join(scratch,'test/fixtures/evotor.js')));
 const receipt=sale({id:'http-sale',close_date:new Date().toISOString()});receipt.body.result_sum='10.00';receipt.body.positions[0].result_sum='10.00';receipt.body.payments[0].payment.sum='10.00';
 const js=await readFile(path.join(scratch,'pos-admin.js'),'utf8'),css=await readFile(path.join(scratch,'pos-admin.css'),'utf8');
 server=createServer(async(req,res)=>{
  const url=new URL(req.url,origin);const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  try{
   if(url.pathname==='/provider'){
    providerCalls++;assert.equal(req.headers.authorization,'Bearer local-fixture-only');
    if(holdProvider)await new Promise(resolve=>releaseProvider=resolve);
    return json(providerStatus,providerStatus===200?{items:[receipt],paging:{}}:{error:'fixture'});
   }
   if(url.pathname==='/pos.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(js);}
   if(url.pathname==='/pos.css'){res.setHeader('Content-Type','text/css; charset=utf-8');return res.end(css);}
   if(url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<link rel="stylesheet" href="/pos.css"><style>body{margin:8px;font:16px sans-serif}*{box-sizing:border-box}</style><div data-screen="admin" class="active"><div id="posAdminMount"></div></div><script>window.state={profile:{role:"admin"}};window.api=async(path,options={})=>{const r=await fetch(path,{method:options.method||"GET",body:options.body,headers:{"Content-Type":"application/json"}});const value=await r.json();if(!r.ok)throw Error(value.error);return value;};</script><script src="/pos.js"></script>');}
   if(url.pathname==='/api/admin/pos/dashboard'&&req.method==='GET')return json(200,await service.dashboard(actor,Object.fromEntries(url.searchParams)));
   if(url.pathname==='/api/admin/pos/sync'&&req.method==='POST'){posts++;return json(200,await service.sync(actor));}
   if(url.pathname==='/api/admin/pos/link'&&req.method==='POST'){
    linkPosts++;let body='';for await(const chunk of req){body+=chunk;assert.ok(body.length<=4096,'Fixture payload limit');}
    if(holdLink)await new Promise(resolve=>releaseLink=resolve);
    const command=JSON.parse(body);linkBodies.push(command);const result=await service.link(actor,command);
    if(truncateLinkReply){truncateLinkReply=false;res.writeHead(200,{'Content-Type':'application/json'});return res.end('{"ok":');}
    return json(200,result);
   }
   return json(404,{error:'Unknown fixture route'});
  }catch(error){json(error.statusCode||500,{error:error.message,code:error.code});}
 });
 await listen(server);origin=`http://127.0.0.1:${server.address().port}`;
 globalThis.fetch=(input,options)=>{
  const url=new URL(input);
  if(url.origin==='https://api.evotor.ru'){assert.equal(url.pathname,'/stores/bar/documents');return nativeFetch(origin+'/provider'+url.search,options);}
  assert.equal(url.origin,origin,'No external network permitted');return nativeFetch(input,options);
 };
 browser=await createRequire(import.meta.url)(process.argv[2]).chromium.launch({headless:true,executablePath:process.argv[3]});
 for(const width of [390,1440]){
  db=new PGlite();await db.exec(`CREATE TABLE users(id BIGSERIAL PRIMARY KEY,qr_token TEXT,qr_short_code TEXT,merged_into_user_id BIGINT,deleted_at TIMESTAMPTZ);CREATE TABLE qr_aliases(qr_token TEXT,qr_short_code TEXT,user_id BIGINT,source_user_id BIGINT);CREATE TABLE wallets(user_id BIGINT PRIMARY KEY,balance BIGINT);CREATE TABLE transactions(client_id BIGINT,status TEXT,check_amount_cents BIGINT,created_at TIMESTAMPTZ);INSERT INTO users(id,qr_token,qr_short_code) VALUES(1,'ClientToken_123456789','PVK-AAAA-2222'),(2,'OtherToken_123456789','PVK-BBBB-3333'),(3,NULL,NULL);INSERT INTO wallets VALUES(3,1000);`);
  await db.exec(await readFile(path.join(scratch,'migrations/012_evotor_sales.sql'),'utf8'));
  const query=(sql,args)=>{if(failLinkInsert&&sql.includes('INSERT INTO pos_customer_links')){failLinkInsert=false;return Promise.reject(new Error('Fixture link SQL outage'));}return sql.includes('pg_try_advisory_lock')?Promise.resolve({rows:[{locked:true}]}):sql.includes('pg_advisory_unlock')?Promise.resolve({rows:[]}):db.query(sql,args);};
  service=createPosService({query,connect:async()=>({query,release(){}})},config);actor={id:'3',role:'admin'};providerStatus=200;config.enabled=true;
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin);await page.waitForFunction(()=>document.querySelector('#posConnection')?.textContent.includes('Ожидаем первую'));
  assert.equal(await page.locator('.pos-metric').count(),0);cases.push({width,scenario:'initial-awaiting-no-invented-zero'});
  const before=posts;holdProvider=true;releaseProvider=null;
  await page.locator('#posSync').click();for(let attempts=0;!releaseProvider&&attempts<1000;attempts++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(releaseProvider,'Local provider reached within 10 seconds');
  assert.equal(await page.locator('#posSync').isDisabled(),true);await page.evaluate(()=>document.querySelector('#posSync').click());assert.equal(posts,before+1);
  holdProvider=false;releaseProvider();await page.waitForFunction(()=>!document.querySelector('#posSync').disabled&&document.querySelector('#posConnection').textContent.includes('Касса подключена'));
  await page.locator('[data-pos-tab="all"]').click();assert.match(await page.locator('#posResult').innerText(),/10,00 ₽/);
  const dashboard=await (await nativeFetch(origin+'/api/admin/pos/dashboard?period=today')).json();assert.equal(dashboard.all.netCents,'1000');assert.equal(dashboard.app.netCents,'0');assert.equal(dashboard.all.receiptCount,1);cases.push({width,scenario:'owner-click-http-provider-import-sql-visible-cash'});
  await page.locator('[data-pos-tab="app"]').click();assert.match(await page.locator('#posResult').innerText(),/0,00 ₽/);cases.push({width,scenario:'anonymous-sale-not-attributed'});
  await page.locator('#posSync').click();await page.waitForFunction(()=>!document.querySelector('#posSync').disabled);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM pos_documents')).rows[0].n,1);assert.equal((await service.dashboard(actor,{period:'today'})).all.netCents,'1000');cases.push({width,scenario:'repeat-http-sync-counted-once'});
  await page.locator('[data-pos-tab="all"]').click();await page.locator('[data-pos-link="http-sale"]').click();
  assert.equal(await page.locator('#posDocument').inputValue(),'http-sale');
  const links=async()=>(await db.query('SELECT * FROM pos_customer_links ORDER BY document_id')).rows;
  const confirmFailure=async(qr,message)=>{
   await page.locator('#posQr').fill(qr);await page.locator('#posConfirm').click();
   await page.waitForFunction(message=>!document.querySelector('#posConfirm').disabled&&document.querySelector('#posConnection').textContent.includes(message),message);
   assert.equal(await page.locator('#posLinkForm').isVisible(),true);assert.deepEqual(await links(),[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'QR form fits viewport');
   assert.equal((await service.dashboard({id:'3',role:'admin'},{period:'today'})).app.netCents,'0');
  };
  await confirmFailure('PVK-ZZZZ-9999','QR клиента не найден');cases.push({width,scenario:'unknown-qr-ui-error-no-attribution'});
  failLinkInsert=true;await confirmFailure('PVK-AAAA-2222','Fixture link SQL outage');cases.push({width,scenario:'link-sql-outage-rolls-back-and-ui-retains-form'});
  actor={id:'3',role:'viewer'};await confirmFailure('PVK-AAAA-2222','Недостаточно прав');actor={id:'3',role:'admin'};cases.push({width,scenario:'revoked-write-role-rejected-through-confirm-ui'});
  await page.locator('#posQr').fill('PVK-AAAA-2222');truncateLinkReply=true;const bodyStart=linkBodies.length;holdLink=true;releaseLink=null;const linksBefore=linkPosts;
  await page.locator('#posConfirm').click();for(let attempts=0;!releaseLink&&attempts<1000;attempts++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(releaseLink,'Local link request reached within 10 seconds');
  assert.equal(await page.locator('#posConfirm').isDisabled(),true);await page.evaluate(()=>document.querySelector('#posConfirm').click());assert.equal(linkPosts,linksBefore+1);holdLink=false;releaseLink();
  await page.waitForFunction(()=>!document.querySelector('#posConfirm').disabled&&document.querySelector('#posLinkForm').hidden===false);
  const persistedAfterLostReply=await links();assert.equal(persistedAfterLostReply.length,1);assert.equal(String(persistedAfterLostReply[0].client_id),'1');
  assert.equal(await page.locator('#posDocument').inputValue(),'http-sale');assert.equal(await page.locator('#posQr').inputValue(),'PVK-AAAA-2222');
  assert.ok(!(await page.locator('#posResult').innerText()).includes('Профиль №1'),'UI has not received a confirmed link result');
  assert.match(await page.locator('#posResult').innerText(),/10,00 ₽/);assert.match(await page.locator('#posConnection').innerText(),/JSON/);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  cases.push({width,scenario:'committed-link-truncated-http-reply-retains-retry-form'});
  actor={id:'3',role:'viewer'};await page.locator('#posConfirm').click();
  await page.waitForFunction(()=>!document.querySelector('#posConfirm').disabled&&document.querySelector('#posConnection').textContent.includes('Недостаточно прав'));
  assert.deepEqual(await links(),persistedAfterLostReply);assert.equal(await page.locator('#posLinkForm').isVisible(),true);
  assert.equal(await page.locator('#posQr').inputValue(),'PVK-AAAA-2222');cases.push({width,scenario:'permission-refusal-after-uncertain-result-preserves-confirmation'});
  actor={id:'3',role:'admin'};await page.locator('#posConfirm').click();
  await page.waitForFunction(()=>!document.querySelector('#posConfirm').disabled&&document.querySelector('#posLinkForm').hidden&&document.querySelector('#posResult').textContent.includes('Профиль №1'));
  const confirmed=await links();assert.deepEqual(confirmed,persistedAfterLostReply);assert.deepEqual(linkBodies.slice(bodyStart),Array.from({length:3},()=>({documentId:'http-sale',qr:'PVK-AAAA-2222'})));recoveryEvidence.push({width,bodies:linkBodies.slice(bodyStart),confirmation:confirmed});cases.push({width,scenario:'original-command-ui-retry-recovers-one-persisted-confirmation'});assert.equal(confirmed.length,1);assert.equal(String(confirmed[0].client_id),'1');assert.equal(String(confirmed[0].confirmed_by),'3');assert.ok(confirmed[0].confirmed_at);
  await page.locator('[data-pos-tab="app"]').click();assert.match(await page.locator('#posResult').innerText(),/10,00 ₽/);assert.equal((await service.dashboard(actor,{period:'today'})).all.netCents,'1000');cases.push({width,scenario:'explicit-qr-confirm-ui-http-sql-audit-and-loyalty'});
  const linkRequest=body=>nativeFetch(origin+'/api/admin/pos/link',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const replay=await linkRequest({documentId:'http-sale',qr:'PVK-AAAA-2222'});assert.equal(replay.status,200);assert.equal((await replay.json()).clientId,'1');assert.deepEqual(await links(),confirmed);cases.push({width,scenario:'same-qr-replay-retains-one-original-confirmation'});
  assert.equal((await linkRequest({documentId:'http-sale',qr:'PVK-BBBB-3333'})).status,409);assert.deepEqual(await links(),confirmed);cases.push({width,scenario:'other-client-conflict-does-not-reassign'});
  await db.query("INSERT INTO pos_documents(source,store_id,document_id,type,closed_at,amount_cents,snapshot) SELECT source,'other','foreign-sale',type,closed_at,amount_cents,snapshot FROM pos_documents WHERE store_id='bar' AND document_id='http-sale'");
  assert.equal((await linkRequest({documentId:'foreign-sale',qr:'PVK-AAAA-2222'})).status,404);
  assert.equal((await linkRequest({documentId:7,qr:'PVK-AAAA-2222'})).status,400);assert.equal((await linkRequest({documentId:'absent',qr:'PVK-AAAA-2222'})).status,404);assert.deepEqual(await links(),confirmed);cases.push({width,scenario:'malformed-missing-and-foreign-store-document-no-link-change'});
  providerStatus=401;await page.locator('#posSync').click();await page.waitForFunction(()=>!document.querySelector('#posSync').disabled&&document.querySelector('#posConnection').textContent.includes('token_expired'));
  await page.locator('#posRefresh').click();await page.waitForFunction(()=>document.querySelector('#posConnection').textContent.includes('Токен истёк'));
  await page.locator('[data-pos-tab="all"]').click();assert.match(await page.locator('#posResult').innerText(),/10,00 ₽/);assert.equal((await service.dashboard(actor,{period:'today'})).connection.state,'error');cases.push({width,scenario:'provider-401-retains-sql-cash-and-error'});
  const calls=providerCalls;actor={id:'3',role:'viewer'};const denied=await nativeFetch(origin+'/api/admin/pos/sync',{method:'POST'});assert.equal(denied.status,403);assert.equal(providerCalls,calls);cases.push({width,scenario:'viewer-write-denied-before-provider'});
  actor=null;assert.equal((await nativeFetch(origin+'/api/admin/pos/dashboard')).status,401);actor={id:'3',role:'admin'};
  assert.equal((await nativeFetch(origin+'/api/admin/pos/dashboard?period=custom&from=2026-02-30&to=2026-03-01')).status,400);cases.push({width,scenario:'unauthenticated-and-invalid-calendar-rejected'});
  config.enabled=false;await page.locator('#posRefresh').click();await page.waitForFunction(()=>document.querySelector('#posConnection').textContent.includes('Касса не подключена'));assert.equal(await page.locator('.pos-metric').count(),0);cases.push({width,scenario:'disabled-connection-hides-cached-metrics'});
  assert.deepEqual((await db.query('SELECT * FROM wallets')).rows,[{user_id:3,balance:1000}]);assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM transactions')).rows[0].n,0);assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.close();await db.close();db=null;
 }
 console.log(JSON.stringify({pin,sourceSha256:hashes,httpBrowserCases:cases.length,cases,providerCalls,recoveryEvidence,syntheticActor:true,advisoryLocksStubbed:true,fullAppBootVerified:false,productionAuthorizationVerified:false},null,2));
}finally{
 globalThis.fetch=nativeFetch;if(releaseProvider)releaseProvider();if(releaseLink)releaseLink();if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));if(db)await db.close();await rm(scratch,{recursive:true,force:true});
}
