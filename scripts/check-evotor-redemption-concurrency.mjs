// Fresh test database only; this does not run against Railway or a real wallet.
import pg from 'pg';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPosDeviceService } from '../pos/devices.js';
import { createPosHttp } from '../pos/http.js';
import { processPosRedemptions } from '../pos/redemption.js';
import { importEvotorPage } from '../pos/repository.js';
import { sale } from '../test/fixtures/evotor.js';
const root=new URL('../',import.meta.url);
const target=new URL(process.env.PIVNIK_TEST_DATABASE_URL || 'invalid:');
if (!['postgres:','postgresql:'].includes(target.protocol) || !['127.0.0.1','localhost','[::1]'].includes(target.hostname) || target.pathname!=='/evotor_redemption_test' || target.search || target.hash) throw new Error('Use a fresh disposable loopback database named evotor_redemption_test.');
const pool=new pg.Pool({connectionString:target.href,max:12,connectionTimeoutMillis:5000});
const checks=[];
const config={enabled:true,bonusEnabled:true,redemptionEnabled:true,storeId:'bar'};
const policy={isUnlimited:()=>false,unlimitedBalance:9999999999999};
try {
  const seed=await readFile(new URL('test/fixtures/evotor-redemption.sql',root),'utf8');
  await pool.query(seed);
  for(const file of ['012_evotor_sales.sql','013_evotor_pos_scope_devices.sql','014_evotor_bonus_accrual.sql','023_evotor_redemptions.sql']) await pool.query(await readFile(new URL('migrations/'+file,root),'utf8'));
  await pool.query("INSERT INTO pos_store_bindings VALUES('bar','tenant','location',TRUE); INSERT INTO pos_operator_access VALUES(3,'bar',TRUE,NULL)");
  const devices=createPosDeviceService(pool,config,policy);
  const issued=await devices.issue({id:'3',role:'admin',termsAccepted:true},{storeId:'bar',externalDeviceId:'test',label:'test'});
  const auth='Device '+issued.deviceToken,http=createPosHttp(pool,config,Date.now,policy);
  const request=body=>http.device({method:'POST',pathname:'/api/device/pos/redemptions',authorization:auth,body});
  const bind=receiptUuid=>devices.bind(auth,{receiptUuid,payload:'PVK-AAAA-2222'});
  const body=(receiptUuid,points=300,totalCents=100000)=>({action:'reserve',receiptUuid,operationId:randomUUID(),clientId:'1',basketHash:'a'.repeat(64),points,totalCents});
  const balance=async()=>Number((await pool.query('SELECT balance FROM wallets WHERE user_id=1')).rows[0].balance);
  const cancel=op=>request({action:'cancel',receiptUuid:op.receiptUuid,operationId:op.operationId,effectRemoved:true});
  await bind('same-receipt');const op=body('same-receipt');
  const same=await Promise.all([request(op),request(op),request(op)]);
  assert.equal(new Set(same.map(x=>x.redemption.operationId)).size,1);assert.equal(await balance(),700);
  checks.push('three concurrent retries: one reservation/debit');
  await cancel(op);assert.equal(await balance(),1000);
  await Promise.all([bind('receipt-a'),bind('receipt-b')]);
  const pair=[body('receipt-a',600,200000),body('receipt-b',600,200000)];
  const race=await Promise.allSettled(pair.map(request));
  assert.equal(race.filter(x=>x.status==='fulfilled').length,1);assert.equal(await balance(),400);
  assert.equal(race.find(x=>x.status==='rejected').reason.statusCode,409);
  checks.push('two receipts competing for one wallet: no double spend');
  const winner=pair[race.findIndex(x=>x.status==='fulfilled')];
  const document=sale({id:winner.receiptUuid,close_date:new Date().toISOString(),extras:{pivnikLoyaltyV1:{version:1,operationId:winner.operationId,points:600}},
    body:{result_sum:1400,positions:[],payments:[],doc_discounts:[{doc_discount:{discount_sum:600}}]}});
  await importEvotorPage(pool,'bar',{items:[document],paging:{}},{until:new Date().toISOString()});
  await Promise.all([processPosRedemptions(pool,{storeId:'bar',policy}),processPosRedemptions(pool,{storeId:'bar',policy})]);
  assert.equal(await balance(),400);
  for(const id of ['return-a','return-b']) {
    await importEvotorPage(pool,'bar',{items:[sale({id,type:'PAYBACK',close_date:new Date().toISOString(),body:{base_document_id:winner.receiptUuid,result_sum:700,positions:[],payments:[]}})],paging:{}},{until:new Date().toISOString()});
  }
  await Promise.all(Array.from({length:3},()=>processPosRedemptions(pool,{storeId:'bar',policy})));
  assert.equal(await balance(),1000);
  assert.equal(Number((await pool.query('SELECT SUM(points) AS n FROM pos_redemption_refunds')).rows[0].n),600);
  assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM pos_redemption_refunds')).rows[0].n),2);
  checks.push('three concurrent reconcilers: settlement/refund each exactly once');
  await bind('wallet-writer-race');const walletOp=body('wallet-writer-race',600,200000);
  const competingWriter=async()=>{
    const db=await pool.connect();
    try {await db.query('BEGIN');await db.query('SELECT id FROM users WHERE id=1 FOR UPDATE');
      const w=await db.query('UPDATE wallets SET balance=balance-600 WHERE user_id=1 AND balance>=600 RETURNING balance');
      await db.query('COMMIT');return w.rows.length>0;
    }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
  };
  const [reserved,spent]=await Promise.allSettled([request(walletOp),competingWriter()]);
  assert.equal((reserved.status==='fulfilled'?1:0)+(spent.status==='fulfilled'&&spent.value?1:0),1);
  assert.equal(await balance(),400);
  checks.push('reservation and competing locked wallet debit: exactly one succeeds');
  console.log(JSON.stringify({postgres:'17',checks,passed:checks.length},null,2));
} finally {await pool.end();}
