import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { normalizeRequestKey } from '../platform-core.js';
import { createAdminAdjustmentPersistence } from '../admin-adjustment-persistence.js';

const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
const fragment = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'Actual route/helper anchors required');
  return source.slice(a, b);
};
async function fixture(t) {
  const db = new PGlite(); t.after(() => db.close());
  for (const name of ['users','wallets','transactions']) {
    const ddl = source.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\([\\s\\S]*?\\n      \\)`));
    assert.ok(ddl); await db.exec(ddl[0]);
  }
  await db.exec(`ALTER TABLE users ADD COLUMN merged_into_user_id BIGINT;
    ALTER TABLE users ADD COLUMN session_version INTEGER DEFAULT 1;
    ALTER TABLE users ADD COLUMN deleted_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN unlimited_bonus BOOLEAN DEFAULT false;
    INSERT INTO users(id,first_name,role) VALUES(10,'Owner','admin'),(11,'Other','admin'),(12,'Staff','staff'),(20,'Client','client');
    INSERT INTO wallets(user_id,balance) VALUES(20,100)`);
  let connections=0;
  const query = async (sql,params) => {
    const r=await db.query(sql,params);return {...r,rowCount:/^\s*SELECT/i.test(sql)?r.rows.length:r.affectedRows};
  };
  const pool={query,connect:async()=>{connections++;return {query,release(){}};}};
  const app=express();app.use(express.json());
  const wire = new Function('app','pool','verifySession','getProfile','effectiveRoleForAuthenticatedIdentity',
    'ownerTelegramId','ownerVkId','normalizeRequestKey','hasUnlimitedBonus','createAdminAdjustmentPersistence',
    fragment('async function authRequired(', 'async function resolveActingStaff(')+
    fragment('async function lockRequestKey(', 'function signSession(')+
    fragment("app.post('/api/admin/users/:id/adjust'", "app.post('/api/admin/transactions/:id/cancel'"));
  // Authentication boundary is a fixture; SQL, route, role middleware and replay helpers are actual source.
  wire(app,pool,token=>/^1[012]$/.test(token)?{uid:token,sv:1,platform:'telegram'}:null,
    async id=>(await query('SELECT id,role FROM users WHERE id=$1',[id])).rows[0],
    role=>role,null,null,normalizeRequestKey,row=>row.unlimited_bonus===true,createAdminAdjustmentPersistence);
  app.use((error,req,res,next)=>res.status(error.statusCode||500).json({error:error.message}));
  const http=app.listen(0,'127.0.0.1');await once(http,'listening');
  t.after(()=>new Promise(resolve=>http.close(resolve)));
  return {db,get connections(){return connections;},
    snapshot:async()=>({wallets:(await query('SELECT * FROM wallets ORDER BY user_id')).rows,
      journal:(await query('SELECT * FROM transactions ORDER BY id')).rows}),
    adjust:async(patch={},token='10')=>{
      const res=await fetch(`http://127.0.0.1:${http.address().port}/api/admin/users/20/adjust`,{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
        body:JSON.stringify({amount:25,reason:'Replay status fixture',requestKey:'replay-status-key',...patch})});
      return {status:res.status,body:await res.json()};
    }};
}

test('completed credit/debit replays preserve historical result and full database snapshot',async t=>{
  const h=await fixture(t);
  assert.deepEqual(await h.adjust(),{status:200,body:{ok:true,balance:125}});
  assert.deepEqual(await h.adjust({amount:-10,requestKey:'replay-status-debit'}),{status:200,body:{ok:true,balance:115}});
  const before=await h.snapshot();
  assert.deepEqual(await h.adjust(),{status:200,body:{ok:true,balance:125,replayed:true}});
  assert.deepEqual(await h.adjust({amount:-10,requestKey:'replay-status-debit'}),{status:200,body:{ok:true,balance:115,replayed:true}});
  assert.deepEqual(await h.snapshot(),before);
});
test('cancelled/pending/declined/expired corrections cannot replay as successful or execute again',async t=>{
  const h=await fixture(t);await h.adjust();
  // Fixture models already reversed cancellation, not the cancellation route itself.
  await h.db.exec('UPDATE wallets SET balance=100');
  for(const status of ['cancelled','pending','declined','expired']) {
    await h.db.query('UPDATE transactions SET status=$1',[status]);const before=await h.snapshot();
    const reply=await h.adjust();assert.equal(reply.status,409,status);assert.equal(reply.body.code,'ADJUSTMENT_NOT_COMPLETED');
    assert.equal(reply.body.ok,undefined);assert.deepEqual(await h.snapshot(),before);
  }
});
test('replay parameter conflict, unauthorized access and invalid input leave data unchanged',async t=>{
  const h=await fixture(t);await h.adjust();const before=await h.snapshot();
  for(const [patch,token,status] of [[{amount:26},'10',409],[{reason:'Changed'},'10',409],[{},'11',409],
    [{},'',401],[{},'12',403],[{amount:0},'10',400],[{reason:''},'10',400],[{requestKey:''},'10',400]]) {
    const n=h.connections;assert.equal((await h.adjust(patch,token)).status,status);
    if(status===401||status===403||status===400)assert.equal(h.connections,n);
    assert.deepEqual(await h.snapshot(),before);
  }
});
test('journal SQL failure rolls back correction and original-key retry succeeds after recovery',async t=>{
  const h=await fixture(t);const before=await h.snapshot();
  await h.db.exec("ALTER TABLE transactions ADD CONSTRAINT fixture_journal_outage CHECK(reason <> 'Replay status fixture')");
  assert.equal((await h.adjust()).status,500);assert.deepEqual(await h.snapshot(),before);
  await h.db.exec('ALTER TABLE transactions DROP CONSTRAINT fixture_journal_outage');
  assert.deepEqual(await h.adjust(),{status:200,body:{ok:true,balance:125}});
});
