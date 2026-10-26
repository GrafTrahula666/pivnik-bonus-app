import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { syncEvotorRecent } from '../pos/recent-sync.js';
import { fetchEvotorPage } from '../pos/evotor-client.js';
import { sale } from './fixtures/evotor.js';

const config = { enabled: true, token: 'private-fixture', storeId: 'bar' };
const now = () => new Date('2026-10-18T11:30:00Z');
async function fixture() {
  const db = new PGlite();
  await db.exec(await readFile(new URL('./fixtures/evotor-redemption.sql',import.meta.url),'utf8'));
  for (const name of ['012_evotor_sales.sql','013_evotor_pos_scope_devices.sql']) {
    await db.exec(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
  }
  await db.exec("INSERT INTO pos_store_bindings VALUES('bar','tenant','venue',TRUE)");
  await db.exec("INSERT INTO pos_sync_state(store_id,cursor,scan_until,last_success_at,last_error_code) VALUES('bar','stuck-history','2026-10-18T11:00:00Z','2026-10-17T00:00:00Z','invalid_response')");
  const pool = {query:db.query.bind(db),async connect(){return {query:async(q,a)=>q.includes('pg_try_advisory_lock')?{rows:[{locked:true}]}:q.includes('pg_advisory_unlock')?{rows:[]}:db.query(q,a),release(){}};}};
  return {db,pool};
}
test('fresh cash receipt imports despite failed history; exact replay and no wallet/ledger/cursor writes',async()=>{
  const {db,pool}=await fixture();
  try {
    const state=JSON.stringify((await db.query('SELECT * FROM pos_sync_state')).rows);
    const wallet=JSON.stringify((await db.query('SELECT * FROM wallets')).rows);
    const doc=sale({id:'fresh-cash',close_date:'2026-10-18T11:11:32Z'});
    for(let n=0;n<2;n++)assert.deepEqual(await syncEvotorRecent({pool,config,now,fetchPage:async q=>{
      assert.equal(q.cursor,null);assert.equal(q.since,'2026-10-16T11:30:00.000Z');return {items:[doc],paging:{}};
    }}),{imported:1,complete:true});
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM pos_documents')).rows[0].n,1);
    assert.equal(JSON.stringify((await db.query('SELECT * FROM pos_sync_state')).rows),state);
    assert.equal(JSON.stringify((await db.query('SELECT * FROM wallets')).rows),wallet);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM transactions')).rows[0].n,0);
  }finally{await db.close();}
});
test('recent cursor is independent, bounded, and rejected on nonprogress',async()=>{
  const {db,pool}=await fixture();
  try {
    let calls=0;
    const result=await syncEvotorRecent({pool,config,now,maxPages:2,fetchPage:async q=>{calls++;assert.equal(q.cursor,calls===1?null:'recent-2');return {items:[sale({id:'p'+calls})],paging:{next_cursor:'recent-'+(calls+1)}};}});
    assert.deepEqual(result,{imported:2,complete:false});assert.equal(calls,2);
    assert.equal((await db.query('SELECT cursor FROM pos_sync_state')).rows[0].cursor,'stuck-history');
    await assert.rejects(syncEvotorRecent({pool,config,now,fetchPage:async q=>({items:[],paging:{next_cursor:q.cursor||'same'}})}),e=>e.code==='invalid_cursor');
  }finally{await db.close();}
});
test('wrong store and changed financial document roll back the whole page',async()=>{
  const {db,pool}=await fixture();
  try {
    await assert.rejects(syncEvotorRecent({pool,config,now,fetchPage:async()=>({items:[sale({id:'rolled-back'}),sale({store_id:'other'})]})}));
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM pos_documents')).rows[0].n,0);
    await syncEvotorRecent({pool,config,now,fetchPage:async()=>({items:[sale()]})});
    const changed=sale();changed.body.result_sum=101;
    await assert.rejects(syncEvotorRecent({pool,config,now,fetchPage:async()=>({items:[sale({id:'also-rollback'}),changed]})}),e=>e.code==='document_conflict');
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM pos_documents')).rows[0].n,1);
    assert.equal((await db.query('SELECT amount_cents FROM pos_documents')).rows[0].amount_cents,30);
  }finally{await db.close();}
});
test('API sends since only on initial page and keeps historical request format',async()=>{
  const urls=[];const fetchImpl=async(u,o)=>{urls.push(u);assert.equal(o.method,'GET');return new Response(JSON.stringify({items:[],paging:{}}));};
  await fetchEvotorPage({...config,until:now(),since:'2026-10-16T11:30:00Z',fetchImpl});
  assert.equal(urls[0].searchParams.get('since'),String(Date.parse('2026-10-16T11:30:00Z')));
  await fetchEvotorPage({...config,until:now(),since:'2026-10-16T11:30:00Z',cursor:'recent-2',fetchImpl});
  assert.equal(urls[1].search,'?cursor=recent-2');
  await fetchEvotorPage({...config,until:now(),fetchImpl});assert.equal(urls[2].searchParams.has('since'),false);
});

test('optional recent observation records completed ranges, truncated pages and errors without changing history or money',async()=>{
  const {db,pool}=await fixture();
  try {
    await db.exec(await readFile(new URL('../migrations/026_evotor_recent_sync_status.sql',import.meta.url),'utf8'));
    const history=JSON.stringify((await db.query('SELECT * FROM pos_sync_state')).rows);
    const money=JSON.stringify((await db.query('SELECT * FROM wallets')).rows);
    await syncEvotorRecent({pool,config,now,fetchPage:async()=>({items:[sale({id:'observed'})],paging:{}})});
    let row=(await db.query('SELECT * FROM pos_recent_sync_status')).rows[0];
    assert.equal(row.state,'complete');assert.equal(row.pages,1);assert.equal(row.cursor_pending,false);
    assert.equal(row.success_since.toISOString(),'2026-10-16T11:30:00.000Z');assert.equal(row.success_until.toISOString(),'2026-10-18T11:30:00.000Z');
    const successful=row.last_success_at.toISOString();
    await syncEvotorRecent({pool,config,now,maxPages:1,fetchPage:async()=>({items:[],paging:{next_cursor:'more'}})});
    row=(await db.query('SELECT * FROM pos_recent_sync_status')).rows[0];
    assert.equal(row.state,'incomplete');assert.equal(row.cursor_pending,true);assert.equal(row.last_success_at.toISOString(),successful);
    await assert.rejects(syncEvotorRecent({pool,config,now,fetchPage:async()=>{throw Object.assign(new Error('private provider prose'),{code:'network'});}}));
    row=(await db.query('SELECT * FROM pos_recent_sync_status')).rows[0];
    assert.equal(row.state,'error');assert.equal(row.last_error_code,'scan_failed');assert.equal(row.last_success_at.toISOString(),successful);
    assert.equal(JSON.stringify((await db.query('SELECT * FROM pos_sync_state')).rows),history);
    assert.equal(JSON.stringify((await db.query('SELECT * FROM wallets')).rows),money);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM transactions')).rows[0].n,0);
  }finally{await db.close();}
});

test('observation failure never prevents a valid recent receipt import',async()=>{
  const {db,pool}=await fixture();
  try {
    // A presence probe succeeds, but an intentionally missing table rejects only
    // the optional observation. The same connection then imports normally.
    const baseConnect=pool.connect.bind(pool);
    pool.connect=async()=>{const c=await baseConnect();const query=c.query.bind(c);c.query=(q,a)=>q.includes("to_regclass('public.pos_recent_sync_status')")?Promise.resolve({rows:[{ready:true}]}):query(q,a);return c;};
    assert.deepEqual(await syncEvotorRecent({pool,config,now,fetchPage:async()=>({items:[sale({id:'telemetry-fails'})],paging:{}})}),{imported:1,complete:true});
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM pos_documents')).rows[0].n,1);
  }finally{await db.close();}
});
