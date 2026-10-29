import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createPosHttp } from '../pos/http.js';
import { createPosDeviceService } from '../pos/devices.js';
import { createPosService } from '../pos/service.js';
import { importEvotorPage, loadPosDocuments } from '../pos/repository.js';
import { posDashboards } from '../pos/analytics.js';
import { moscowPeriod } from '../pos/evotor-document.js';
import { isAutomaticStartupMigration } from '../migration-startup-policy.js';
import { sale } from './fixtures/evotor.js';

const config={enabled:true,token:'fixture-provider-only',storeId:'bar'};
const owner={id:'3',role:'admin',termsAccepted:true};
const viewer={id:'4',role:'viewer',termsAccepted:true};
const denied=(status)=>e=>e.statusCode===status;
async function fixture(){
  const db=new PGlite();
  await db.exec(`CREATE TABLE users(id BIGINT PRIMARY KEY,first_name TEXT,qr_token TEXT,qr_short_code TEXT,deleted_at TIMESTAMPTZ,merged_into_user_id BIGINT);
    CREATE TABLE qr_aliases(qr_token TEXT,qr_short_code TEXT,user_id BIGINT,source_user_id BIGINT);
    CREATE TABLE wallets(user_id BIGINT,balance BIGINT);
    CREATE TABLE transactions(id BIGINT,amount BIGINT);
    INSERT INTO users(id,first_name,qr_short_code) VALUES(1,'Client','PVK-AAAA-2222'),(2,'Other','PVK-BBBB-3333'),(3,'Admin',NULL),(4,'Viewer',NULL),(5,'Other owner',NULL);
    INSERT INTO qr_aliases(qr_short_code,user_id,source_user_id) VALUES('PVK-CCCC-4444',1,1);
    INSERT INTO wallets VALUES(1,100),(2,200); INSERT INTO transactions VALUES(99,123);`);
  for(const name of ['012_evotor_sales.sql','013_evotor_pos_scope_devices.sql'])await db.exec(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
  await db.exec(`INSERT INTO pos_store_bindings VALUES('bar','tenant-a','loc-a',TRUE),('other','tenant-b','loc-b',TRUE),('same-tenant-other','tenant-a','loc-c',TRUE);
    INSERT INTO pos_operator_access VALUES(3,'bar',TRUE,NULL),(4,'bar',FALSE,NULL),(5,'other',TRUE,NULL);`);
  const pool={query:db.query.bind(db),connect:async()=>({query:db.query.bind(db),release(){}})};
  return {db,pool,close:()=>db.close()};
}
async function financial(db){return {wallets:(await db.query('SELECT * FROM wallets ORDER BY user_id')).rows,journal:(await db.query('SELECT * FROM transactions ORDER BY id')).rows};}

test('POS identity is QR-only, hash-only, audited, revocable and uses the canonical revoked-QR rule',async t=>{
  const f=await fixture();
  try{
    const before=await financial(f.db),devices=createPosDeviceService(f.pool,config);
    const issued=await devices.issue(owner,{storeId:'bar',externalDeviceId:'terminal-1',label:'Till'});
    const auth='Device '+issued.deviceToken;
    await t.test('credential is random 256-bit token, never plaintext in database or listing',async()=>{
      assert.match(issued.deviceToken,/^pvpos_[A-Za-z0-9_-]{43}$/);
      const stored=(await f.db.query('SELECT * FROM pos_devices')).rows;
      assert.match(stored[0].token_hash,/^[a-f0-9]{64}$/);
      assert.ok(!JSON.stringify(stored).includes(issued.deviceToken));
      const listed=await devices.list(owner);
      assert.ok(!JSON.stringify(listed).includes('token_hash'));
      assert.ok(!JSON.stringify(listed).includes(issued.deviceToken));
      await assert.rejects(devices.issue(owner,{storeId:'bar',externalDeviceId:'terminal-1',label:'Retry'}),denied(409));
      assert.equal((await f.db.query('SELECT COUNT(*)::int AS n FROM pos_devices')).rows[0].n,1);
    });
    await t.test('only id and display name resolve; no wallet, QR secret or social session',async()=>{
      assert.deepEqual(await devices.resolve(auth,{payload:'PVK-AAAA-2222'}),{client:{id:'1',firstName:'Client'}});
      await assert.rejects(devices.resolve('Bearer '+issued.deviceToken,{payload:'PVK-AAAA-2222'}),denied(401));
      await assert.rejects(devices.resolve('Device pvpos_'+('A'.repeat(43)),{payload:'PVK-AAAA-2222'}),denied(401));
      await assert.rejects(devices.resolve(auth,{payload:'PVK-CCCC-4444'}),denied(404));
      await assert.rejects(devices.resolve(auth,{payload:'PVK-DDDD-5555'}),denied(404));
    });
    await t.test('POS token cannot act as an admin or staff session; only the exact device route is accepted',async()=>{
      const http=createPosHttp(f.pool,config);
      await assert.rejects(http.admin({method:'POST',pathname:'/api/admin/pos/devices',user:null,body:{}}),denied(401));
      await assert.rejects(http.device({method:'POST',pathname:'/api/staff/transactions',authorization:auth,body:{},address:'test'}),denied(404));
      await assert.rejects(http.device({method:'GET',pathname:'/api/device/pos/qr/resolve',authorization:auth,address:'test'}),denied(404));
    });
    await t.test('revoke is immediate and repeated revoke preserves one audit event',async()=>{
      await devices.revoke(owner,{id:issued.id});
      const row=(await f.db.query('SELECT * FROM pos_devices')).rows[0];
      await devices.revoke(owner,{id:issued.id});
      assert.deepEqual((await f.db.query('SELECT * FROM pos_devices')).rows[0],row);
      await assert.rejects(devices.resolve(auth,{payload:'PVK-AAAA-2222'}),denied(401));
      assert.equal((await f.db.query('SELECT COUNT(*)::int AS n FROM pos_device_audit')).rows[0].n,2);
    });
    assert.deepEqual(await financial(f.db),before);
  }finally{await f.close();}
});

test('tenant/location isolation requires explicit operator access; legacy role and request scope cannot widen it',async t=>{
  const f=await fixture();
  try{
    const sales=createPosService(f.pool,config),devices=createPosDeviceService(f.pool,config);
    await t.test('authorized viewer has only the explicitly granted store',async()=>{
      assert.equal((await sales.dashboard(viewer,{})).connection.state,'awaiting_sync');
      for(const storeId of ['other','same-tenant-other'])await assert.rejects(sales.dashboard(owner,{storeId}),denied(403));
      for(const params of [{tenantId:'tenant-b'},{locationId:'loc-c'}])await assert.rejects(sales.dashboard(owner,params),denied(403));
      await assert.rejects(sales.dashboard({...owner,id:'2'},{}),denied(403));
    });
    await t.test('viewer cannot issue/link/sync; non-granted admin cannot issue or revoke a foreign device',async()=>{
      await assert.rejects(devices.issue(viewer,{storeId:'bar',externalDeviceId:'a',label:'a'}),denied(403));
      await assert.rejects(sales.link(viewer,{documentId:'sale-1',qr:'PVK-AAAA-2222'}),denied(403));
      await assert.rejects(sales.sync(viewer,{}),denied(403));
      const foreign=await devices.issue({...owner,id:'5'},{storeId:'other',externalDeviceId:'b',label:'b'});
      await assert.rejects(devices.revoke(owner,{id:foreign.id,storeId:'other'}),denied(403));
      await assert.rejects(devices.revoke(owner,{id:foreign.id}),denied(404));
    });
    await t.test('disabled store and revoked grant immediately deny later requests',async()=>{
      const issued=await devices.issue(owner,{storeId:'bar',externalDeviceId:'a',label:'a'});
      await f.db.query("UPDATE pos_store_bindings SET enabled=FALSE WHERE store_id='bar'");
      await assert.rejects(devices.resolve('Device '+issued.deviceToken,{payload:'PVK-AAAA-2222'}),denied(401));
      await f.db.query("UPDATE pos_store_bindings SET enabled=TRUE WHERE store_id='bar'");
      await f.db.query('UPDATE pos_operator_access SET revoked_at=NOW() WHERE user_id=3');
      await assert.rejects(sales.dashboard(owner,{}),denied(403));
    });
  }finally{await f.close();}
});

test('device issue audit failure rolls back both device and credential; feature/schema stay opt-in',async()=>{
  const f=await fixture();
  try{
    const devices=createPosDeviceService(f.pool,config);
    await f.db.query("ALTER TABLE pos_device_audit ADD CONSTRAINT fixture_reject CHECK (action<>'issued')");
    await assert.rejects(devices.issue(owner,{storeId:'bar',externalDeviceId:'a',label:'a'}));
    assert.equal((await f.db.query('SELECT COUNT(*)::int AS n FROM pos_devices')).rows[0].n,0);
    assert.equal(isAutomaticStartupMigration('013_evotor_pos_scope_devices.sql'),false);
    await assert.rejects(createPosDeviceService(f.pool,{enabled:false}).resolve('',{}),denied(503));
    const http=createPosHttp(f.pool,config,()=>1000);
    for(let i=0;i<30;i++)await assert.rejects(http.device({method:'POST',pathname:'/api/device/pos/qr/resolve',authorization:'bad',body:{},address:'ip'}),denied(401));
    await assert.rejects(http.device({method:'POST',pathname:'/api/device/pos/qr/resolve',authorization:'bad',body:{},address:'ip'}),denied(429));
    await assert.rejects(http.device({method:'POST',pathname:'/api/device/pos/qr/resolve',authorization:'bad',body:{},address:'other'}),denied(401));
  }finally{await f.close();}
});

test('cash projection: one store, one sale, replay, linked and unlinked sales, return inheritance, unknown checks, no wallet writes',async()=>{
  const f=await fixture();
  try{
    const before=await financial(f.db);
    const persist=async(storeId,items)=>{await f.db.query('BEGIN');try{await importEvotorPage(f.db,storeId,{items},{until:'2026-10-03T00:00:00Z'});await f.db.query('COMMIT');}catch(e){await f.db.query('ROLLBACK');throw e;}};
    const refund=sale({id:'refund',type:'PAYBACK'});refund.body.base_document_id='sale-1';refund.body.pos_print_results=[];
    await persist('bar',[sale(),sale({id:'anonymous'}),refund]);
    await persist('bar',[sale()]);
    await persist('other',[sale({id:'foreign',store_id:'other'})]);
    const service=createPosService(f.pool,config);
    const body={documentId:'sale-1',qr:'PVK-AAAA-2222'};
    const first=await service.link(owner,body);
    assert.deepEqual(await service.link(owner,body),first);
    await assert.rejects(service.link(owner,{...body,qr:'PVK-BBBB-3333'}),denied(409));
    const period={period:'custom',from:'2026-10-02',to:'2026-10-02'};
    const report=await service.dashboard(owner,period);
    assert.equal(report.all.salesCents,'60');assert.equal(report.all.returnsCents,'30');assert.equal(report.all.netCents,'30');
    assert.equal(report.app.salesCents,'30');assert.equal(report.app.returnsCents,'30');assert.equal(report.app.netCents,'0');
    assert.equal(report.unlinked.salesCents,'30');assert.equal(report.linkedRevenueSharePercent,50);
    assert.equal(report.all.activeBuyers,undefined);assert.equal(report.app.activeBuyers,1);
    assert.equal(report.documents.length,3);
    assert.equal(report.documents.find(d=>d.type==='PAYBACK').clientId,'1');
    assert.deepEqual(await service.dashboard(owner,period),report); // Refresh / new service instance.
    assert.deepEqual(await createPosService(f.pool,config).dashboard(owner,period),report);
    const unknown=sale({id:'unknown'});unknown.body.pos_print_results=[];
    await persist('bar',[unknown]);
    const all=posDashboards(await loadPosDocuments(f.db,'bar',moscowPeriod(period))).all;
    assert.equal(all.receiptCount,null);assert.equal(all.averageCents,null);
    assert.deepEqual(await financial(f.db),before);
  }finally{await f.close();}
});
