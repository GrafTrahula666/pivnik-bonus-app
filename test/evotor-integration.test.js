import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { sale } from './fixtures/evotor.js';
import { importEvotorPage, linkEvotorCustomer, loadPosDocuments } from '../pos/repository.js';
import { syncEvotor } from '../pos/sync.js';
import { fetchEvotorPage } from '../pos/evotor-client.js';
import { posDashboards } from '../pos/analytics.js';
import { assertPosRole, createPosService } from '../pos/service.js';
import { moscowPeriod } from '../pos/evotor-document.js';

async function database() {
  const db = new PGlite();
  await db.exec(`CREATE TABLE users(id BIGSERIAL PRIMARY KEY,qr_token TEXT,qr_short_code TEXT,merged_into_user_id BIGINT,deleted_at TIMESTAMPTZ);
    CREATE TABLE qr_aliases(qr_token TEXT,qr_short_code TEXT,user_id BIGINT,source_user_id BIGINT);
    CREATE TABLE transactions(client_id BIGINT,status TEXT,check_amount_cents BIGINT,created_at TIMESTAMPTZ);
    INSERT INTO users(id,qr_token,qr_short_code) VALUES(1,'ClientToken_123456789','PVK-AAAA-2222'),(2,'OtherToken_123456789','PVK-BBBB-3333'),(3,NULL,NULL);`);
  await db.exec(await readFile(new URL('../migrations/012_evotor_sales.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../migrations/013_evotor_pos_scope_devices.sql', import.meta.url), 'utf8'));
  await db.exec(`INSERT INTO pos_store_bindings VALUES('bar','company-1','location-1',TRUE);
    INSERT INTO pos_operator_access VALUES(3,'bar',TRUE,NULL);`);
  return db;
}
const config = { enabled: true, token: 'private', storeId: 'bar' };
const until = '2026-10-03T00:00:00Z';
async function page(db, docs, cursor = null) {
  await db.query('BEGIN');
  try { await importEvotorPage(db,'bar',{items:docs,paging:cursor ? {next_cursor:cursor} : {}},{until}); await db.query('COMMIT'); }
  catch(e) { await db.query('ROLLBACK'); throw e; }
}
// PGlite has no advisory locks; all other queries run in real PostgreSQL/WASM.
function poolFor(db, lock = true) {
  const client = { query: async (sql, args) => sql.includes('pg_try_advisory_lock') ? { rows: [{ locked: lock }] }
    : sql.includes('pg_advisory_unlock') ? { rows: [] } : db.query(sql,args), release() {} };
  return { query: db.query.bind(db), connect: async () => client };
}
test('PostgreSQL: exact replay, conflicting financial payload refuses update, QR link, refund, no bonus writes', async () => {
  const db = await database();
  try {
    await page(db,[sale(),sale({id:'anonymous'})]); await page(db,[sale()]);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM pos_documents')).rows[0].n,2);
    const updated = sale(); updated.body.result_sum = 100.01; updated.body.positions[0].result_sum = 100.01; updated.body.payments[0].payment.sum = 100.01;
    await assert.rejects(page(db,[updated]),e=>e.code==='document_conflict');
    const prior=(await db.query('SELECT * FROM pos_sync_state')).rows;
    const alteredPrint=sale();alteredPrint.body.pos_print_results=[];
    await assert.rejects(page(db,[sale({id:'rolled-back-replay-page'}),alteredPrint]),e=>e.code==='document_conflict');
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM pos_documents WHERE document_id='rolled-back-replay-page'")).rows[0].n,0);
    assert.deepEqual((await db.query('SELECT * FROM pos_sync_state')).rows,prior);
    await linkEvotorCustomer(db,{storeId:'bar',documentId:'sale-1',qr:'PVK-AAAA-2222',actorId:3});
    await linkEvotorCustomer(db,{storeId:'bar',documentId:'sale-1',qr:'PVK-AAAA-2222',actorId:3});
    await assert.rejects(linkEvotorCustomer(db,{storeId:'bar',documentId:'sale-1',qr:'PVK-BBBB-3333',actorId:3}),/другим клиентом/);
    const refund = sale({id:'return-1',type:'PAYBACK'}); refund.body.base_document_id='sale-1';
    await page(db,[refund]);
    const alteredReturn=sale({id:'return-1',type:'PAYBACK'});alteredReturn.body.base_document_id='anonymous';
    await assert.rejects(page(db,[alteredReturn]),e=>e.code==='document_conflict');
    const docs = await loadPosDocuments(db,'bar',moscowPeriod({period:'custom',from:'2026-10-02',to:'2026-10-02'}));
    const metrics = posDashboards(docs);
    assert.equal(metrics.all.salesCents,'60'); assert.equal(metrics.all.netCents,'30');
    assert.equal(metrics.app.netCents,'0'); assert.equal(metrics.app.activeBuyers,1);
    assert.equal(metrics.all.unlinkedSaleDocuments,1);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM transactions')).rows[0].n,0);
    await db.query('UPDATE users SET deleted_at=NOW() WHERE id=1');
    assert.equal(posDashboards(await loadPosDocuments(db,'bar',moscowPeriod({period:'custom',from:'2026-10-02',to:'2026-10-02'}))).app.saleDocuments,0);
  } finally { await db.close(); }
});
test('PostgreSQL: cursor survives interruption, failed page rolls back, resumed full scan finds late documents', async () => {
  const db = await database();
  try {
    const pool = poolFor(db);
    await assert.rejects(syncEvotor({pool,config,fetchPage:async ({cursor}) => {
      if (cursor) throw Object.assign(new Error('secret MUST NOT persist'),{code:'network'});
      return {items:[sale()],paging:{next_cursor:'page-2'}};
    }}),/network/);
    assert.equal((await db.query('SELECT cursor FROM pos_sync_state')).rows[0].cursor,'page-2');
    const result = await syncEvotor({pool,config,fetchPage:async ({cursor}) => { assert.equal(cursor,'page-2'); return {items:[sale({id:'page2'})],paging:{}}; }});
    assert.equal(result.complete,true);
    await syncEvotor({pool,config,fetchPage:async ({cursor}) => { assert.equal(cursor,null); return {items:[sale(),sale({id:'late-offline',close_date:'2026-09-01T10:00:00Z'})],paging:{}}; }});
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM pos_documents')).rows[0].n,3);
    const wrong = sale({id:'bad',store_id:'another'});
    await assert.rejects(syncEvotor({pool,config,fetchPage:async()=>({items:[sale({id:'rollback'}),wrong],paging:{}})}),/invalid_document/);
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM pos_documents WHERE document_id='rollback'")).rows[0].n,0);
    assert.equal((await db.query('SELECT last_error_code FROM pos_sync_state')).rows[0].last_error_code,'invalid_document');
    assert.deepEqual(await syncEvotor({pool:poolFor(db,false),config}),{busy:true});
  } finally { await db.close(); }
});
test('API v2 exact headers, cursor-only pagination, auth/network/rate limit errors and no secret echo', async () => {
  let url, options;
  await fetchEvotorPage({...config,cursor:'a+/=',until,fetchImpl:async (u,o)=>{url=u;options=o;return new Response(JSON.stringify({items:[],paging:{}}));}});
  assert.equal(url.search,'?cursor=a%2B%2F%3D'); assert.equal(options.headers.Authorization,'Bearer private');
  assert.equal(options.headers.Accept,'application/vnd.evotor.v2+json');
  for (const [status,code] of [[401,'token_expired'],[403,'forbidden'],[429,'rate_limit'],[402,'not_installed']]) {
    await assert.rejects(fetchEvotorPage({...config,until,fetchImpl:async()=>new Response('secret',{status})}),e=>e.code===code && !e.message.includes('secret'));
  }
  await assert.rejects(fetchEvotorPage({...config,until,fetchImpl:async()=>{throw Error('private');}}),e=>e.code==='network');
});
test('API rejects malformed response envelopes with a safe provider error', async () => {
  for (const payload of [null, [], true, 'private', 42, {},
    {items:[],paging:[]}, {items:[],paging:'private'}, {items:[],paging:false},
    {items:[],paging:{next_cursor:42}}, {items:new Array(1001).fill(null)}]) {
    await assert.rejects(fetchEvotorPage({...config,until,
      fetchImpl:async()=>new Response(JSON.stringify(payload))}),
    error=>error.code==='invalid_response' && !error.message.includes('private'));
  }
  for (const paging of [undefined, null, {}, {next_cursor:null}, {next_cursor:'next'}]) {
    const payload={items:[],...(paging===undefined?{}:{paging})};
    assert.deepEqual(await fetchEvotorPage({...config,until,
      fetchImpl:async()=>new Response(JSON.stringify(payload))}),payload);
  }
  await assert.rejects(fetchEvotorPage({...config,until,
    fetchImpl:async()=>new Response('{"private":')}),error=>error.code==='invalid_response');
});
test('malformed provider page preserves sales and cursor; recovery and replay do not duplicate sales', async () => {
  const db=await database();
  try {
    const pool=poolFor(db);
    await page(db,[sale()]);
    await page(db,[],'resume-page');
    const documents=(await db.query('SELECT * FROM pos_documents')).rows;
    const before=(await db.query('SELECT cursor,scan_until,last_success_at FROM pos_sync_state')).rows;
    for(const payload of [null,{items:[],paging:[]}]) {
      await assert.rejects(syncEvotor({pool,config,fetchPage:args=>fetchEvotorPage({...args,
        fetchImpl:async()=>new Response(JSON.stringify(payload))})}),error=>error.code==='invalid_response' && error.statusCode===502);
      assert.deepEqual((await db.query('SELECT * FROM pos_documents')).rows,documents);
      assert.deepEqual((await db.query('SELECT cursor,scan_until,last_success_at FROM pos_sync_state')).rows,before);
      const dashboard=await createPosService(pool,config).dashboard({id:'3',role:'viewer'},
        {period:'custom',from:'2026-10-02',to:'2026-10-02'});
      assert.equal(dashboard.connection.state,'error');
      assert.equal(dashboard.connection.errorCode,'invalid_response');
      assert.equal(dashboard.all.saleDocuments,1);
    }
    const fetchPage=args=>fetchEvotorPage({...args,fetchImpl:async()=>{
      assert.equal(args.cursor,'resume-page');
      return new Response(JSON.stringify({items:[sale()],paging:{}}));
    }});
    assert.deepEqual(await syncEvotor({pool,config,fetchPage}),{imported:1,complete:true});
    await syncEvotor({pool,config,fetchPage:args=>fetchEvotorPage({...args,
      fetchImpl:async()=>new Response(JSON.stringify({items:[sale()],paging:{}}))})});
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM pos_documents')).rows[0].n,1);
    assert.equal((await db.query('SELECT last_error_code FROM pos_sync_state')).rows[0].last_error_code,null);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM transactions')).rows[0].n,0);
  } finally {await db.close();}
});
test('PostgreSQL: revoked QR and split receipts cannot link; Moscow boundary and repeat buyers are exact', async () => {
  const db = await database();
  try {
    await db.query("INSERT INTO qr_aliases(qr_short_code,user_id,source_user_id) VALUES('PVK-CCCC-4444',1,1)");
    const split = sale({id:'split'});
    split.body.pos_print_results.push(split.body.pos_print_results[0]);
    await page(db,[sale(),split,sale({id:'second'}),sale({id:'before',close_date:'2026-10-01T20:59:59Z'}),sale({id:'after',close_date:'2026-10-02T21:00:00Z'})]);
    await assert.rejects(linkEvotorCustomer(db,{storeId:'bar',documentId:'sale-1',qr:'PVK-CCCC-4444',actorId:3}));
    await assert.rejects(linkEvotorCustomer(db,{storeId:'bar',documentId:'split',qr:'PVK-AAAA-2222',actorId:3}));
    for (const documentId of ['sale-1','second']) await linkEvotorCustomer(db,{storeId:'bar',documentId,qr:'PVK-AAAA-2222',actorId:3});
    const docs = await loadPosDocuments(db,'bar',moscowPeriod({period:'custom',from:'2026-10-02',to:'2026-10-02'}));
    assert.equal(docs.length,3);
    const metrics = posDashboards(docs);
    assert.equal(metrics.all.receiptCount,4);
    assert.equal(metrics.app.activeBuyers,1);
    assert.equal(metrics.app.repeatBuyers,1);
    assert.equal(metrics.app.saleDocuments,2);
  } finally { await db.close(); }
});
test('PostgreSQL: expired token preserves successful sync; invalid cursor restarts safely', async () => {
  const db = await database();
  try {
    const pool=poolFor(db);
    await page(db,[sale()]);
    const previous=(await db.query('SELECT last_success_at FROM pos_sync_state')).rows[0].last_success_at;
    await page(db,[], 'stale-cursor');
    await assert.rejects(syncEvotor({pool,config,fetchPage:async()=>{throw Object.assign(new Error('private'),{code:'token_expired'});}}), /token_expired/);
    const service=createPosService(pool,config);
    const dashboard=await service.dashboard({id:'3',role:'viewer'},{period:'custom',from:'2026-10-02',to:'2026-10-02'});
    assert.equal(dashboard.connection.state,'error');
    assert.equal(dashboard.connection.errorCode,'token_expired');
    assert.equal(new Date(dashboard.connection.lastSuccessAt).getTime(),new Date(previous).getTime());
    assert.equal(dashboard.all.saleDocuments,1);
    await assert.rejects(syncEvotor({pool,config,fetchPage:async()=>{throw Object.assign(new Error('bad cursor'),{code:'invalid_cursor'});}}), /invalid_cursor/);
    assert.equal((await db.query('SELECT cursor FROM pos_sync_state')).rows[0].cursor,null);
    await syncEvotor({pool,config,fetchPage:async ({cursor})=>{assert.equal(cursor,null);return {items:[sale()],paging:{}};}});
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM pos_documents')).rows[0].n,1);
    assert.equal((await db.query('SELECT last_error_code FROM pos_sync_state')).rows[0].last_error_code,null);
  } finally { await db.close(); }
});
test('RBAC read/admin write only and never zero revenue before first successful sync', async () => {
  for (const role of ['client','staff','terminal']) assert.throws(()=>assertPosRole({id:'1',role}));
  assert.throws(()=>assertPosRole({id:'1',role:'viewer'},true)); assert.throws(()=>assertPosRole(null));
  assertPosRole({id:'3',role:'admin'},true); assertPosRole({id:'3',role:'viewer'});
  const db=await database();
  try {
    const service=createPosService(poolFor(db),config);
    const result=await service.dashboard({id:'3',role:'viewer'},{});
    assert.equal(result.connection.state,'awaiting_sync');assert.equal(result.all,null);
    const disabled=await createPosService(poolFor(db),{...config,enabled:false}).dashboard({id:'3',role:'admin'},{});
    assert.equal(disabled.connection.state,'not_connected'); assert.equal(disabled.app,null);
    await assert.rejects(service.link({id:'1',role:'client'},{documentId:'sale-1',qr:'PVK-AAAA-2222'}));
  } finally { await db.close(); }
});
