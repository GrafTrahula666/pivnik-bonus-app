import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import httpTransport from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { normalizeRequestKey } from '../platform-core.js';
import { createAdminAdjustmentPersistence } from '../admin-adjustment-persistence.js';

const gatewaySource = await readFile(new URL('../universal-server.js', import.meta.url), 'utf8');
const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
const fragment = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'Actual route/helper anchors required');
  return source.slice(a, b);
};
async function fixture(t, { gateway = false, platform = 'telegram' } = {}) {
  const db = new PGlite(); t.after(() => db.close());
  for (const name of ['users','wallets','transactions']) {
    const ddl = source.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\([\\s\\S]*?\\n      \\)`));
    assert.ok(ddl); await db.exec(ddl[0]);
  }
  await db.exec(`ALTER TABLE users ADD COLUMN merged_into_user_id BIGINT;
    ALTER TABLE users ADD COLUMN session_version INTEGER DEFAULT 1;
    ALTER TABLE users ADD COLUMN deleted_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN unlimited_bonus BOOLEAN DEFAULT false;
    ALTER TABLE transactions ADD COLUMN cancel_request_key TEXT;
    ALTER TABLE transactions ADD COLUMN cancel_reason TEXT;
    ALTER TABLE transactions ADD COLUMN cancelled_by BIGINT REFERENCES users(id);
    ALTER TABLE transactions ADD COLUMN cancelled_at TIMESTAMPTZ;
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
    'sendTelegramMessage','transactionResponse',
    fragment('async function authRequired(', 'async function resolveActingStaff(')+
    fragment('async function lockRequestKey(', 'function signSession(')+
    fragment("app.post('/api/admin/users/:id/adjust'", "app.post('/api/admin/transactions/:id/cancel'")+
    fragment('async function cancelCompletedTransaction(', "app.get('/api/health'")+
    fragment("app.post('/api/admin/transactions/:id/cancel'", "app.post('/api/admin/users/:id/cancel-limit/reset'"));
  // Authentication boundary is a fixture; SQL, route, role middleware and replay helpers are actual source.
  wire(app,pool,token=>{
    const match=String(token).match(/^(?:(telegram|vk):)?(1[012])$/);
    return match?{uid:match[2],sv:1,platform:match[1]||platform}:null;
  },
    async id=>(await query('SELECT id,role FROM users WHERE id=$1',[id])).rows[0],
    role=>role,null,null,normalizeRequestKey,row=>row.unlimited_bonus===true,createAdminAdjustmentPersistence,
    async()=>{throw Error('Unexpected notification for denied cancellation');},
    ()=>{throw Error('Unexpected successful cancellation serialization');});
  app.use((error,req,res,next)=>res.status(error.statusCode||500).json({error:error.message}));
  const http=app.listen(0,'127.0.0.1');await once(http,'listening');
  t.after(()=>new Promise(resolve=>http.close(resolve)));
  let port=http.address().port;
  const state={port,ready:true}, canonicalized=[];
  if(gateway) {
    const start=gatewaySource.indexOf('async function readRequestBody(');
    const end=gatewaySource.indexOf('export async function renderAppIndex(',start);
    assert.ok(start>=0&&end>start);
    // Real body reader, sendJson and proxyRequest; token canonicalizer is an explicit fixture.
    // This tests transport, not the full public dispatcher/consent/HMAC authentication.
    const proxySource=gatewaySource.slice(start,end);
    const wireProxy=new Function('http','canonicalizeSessionToken','console','MAX_BODY_BYTES',
      `return (state)=>{let internalPort=state.port,childReady=state.ready; ${proxySource}
`+
      `return async(req,res)=>{internalPort=state.port;childReady=state.ready;return proxyRequest(req,res);};};`);
    const proxy=wireProxy(httpTransport,async token=>{
      const match=String(token).match(/^(telegram|vk):(1[012])$/);
      if(!match)return {payload:null};
      canonicalized.push({platform:match[1],uid:match[2]});
      return {payload:{uid:match[2],platform:match[1]},token};
    },{error(){}},1048576)(state);
    const server=httpTransport.createServer((req,res)=>proxy(req,res).catch(error=>{
      res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message}));
    }));
    server.listen(0,'127.0.0.1');await once(server,'listening');port=server.address().port;
    t.after(()=>new Promise(resolve=>server.close(resolve)));
  }
  const request=async(path,body,token)=>{
    const res=await fetch(`http://127.0.0.1:${port}${path}`,{method:'POST',
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
    return {status:res.status,body:await res.json()};
  };
  const ownerToken=gateway?`${platform}:${platform==='vk'?'11':'10'}`:'10';
  return {db,state,canonicalized,cancel:(id,patch={},token=ownerToken)=>request(`/api/admin/transactions/${id}/cancel`,
    {reason:'Cancel correction fixture',requestKey:'cancel-correction-key',...patch},token),stopUpstream:()=>new Promise(resolve=>http.close(resolve)),get connections(){return connections;},
    snapshot:async()=>({wallets:(await query('SELECT * FROM wallets ORDER BY user_id')).rows,
      journal:(await query('SELECT * FROM transactions ORDER BY id')).rows}),
    adjust:async(patch={},token=gateway?`${platform}:${platform==='vk'?'11':'10'}`:'10')=>{
      const res=await fetch(`http://127.0.0.1:${port}/api/admin/users/20/adjust`,{
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

for(const platform of ['telegram','vk']) {
  test(`${platform} gateway proxy preserves completed replay and unfinished-state 409 without SQL mutation`,async t=>{
    const h=await fixture(t,{gateway:true,platform});
    assert.deepEqual(await h.adjust(),{status:200,body:{ok:true,balance:125}});
    assert.deepEqual(await h.adjust({amount:-10,requestKey:'gateway-debit-key'}),{status:200,body:{ok:true,balance:115}});
    const completed=await h.snapshot();
    assert.deepEqual(await h.adjust(),{status:200,body:{ok:true,balance:125,replayed:true}});
    assert.deepEqual(await h.adjust({amount:-10,requestKey:'gateway-debit-key'}),{status:200,body:{ok:true,balance:115,replayed:true}});
    assert.deepEqual(await h.snapshot(),completed);
    assert.equal(String(completed.journal[0].staff_id),platform==='vk'?'11':'10');
    for(const status of ['cancelled','pending','declined','expired']) {
      await h.db.query('UPDATE transactions SET status=$1',[status]);const before=await h.snapshot();
      const reply=await h.adjust();assert.equal(reply.status,409);assert.equal(reply.body.code,'ADJUSTMENT_NOT_COMPLETED');
      assert.equal(reply.body.ok,undefined);assert.deepEqual(await h.snapshot(),before);
    }
    assert.ok(h.canonicalized.length>0);assert.ok(h.canonicalized.every(c=>c.platform===platform));
  });
  test(`${platform} gateway proxy preserves access/input errors and rollback recovery`,async t=>{
    const h=await fixture(t,{gateway:true,platform}),before=await h.snapshot();
    for(const [patch,token,status] of [[{},'',401],[{},`${platform}:12`,403],[{amount:0},undefined,400],
      [{reason:''},undefined,400],[{requestKey:''},undefined,400]]) {
      const n=h.connections;assert.equal((await h.adjust(patch,token)).status,status);
      assert.equal(h.connections,n);assert.deepEqual(await h.snapshot(),before);
    }
    await h.db.exec("ALTER TABLE transactions ADD CONSTRAINT fixture_proxy_outage CHECK(reason <> 'Replay status fixture')");
    assert.equal((await h.adjust()).status,500);assert.deepEqual(await h.snapshot(),before);
    await h.db.exec('ALTER TABLE transactions DROP CONSTRAINT fixture_proxy_outage');
    assert.equal((await h.adjust()).status,200);
    const committed=await h.snapshot();assert.equal((await h.adjust({amount:26})).status,409);
    assert.deepEqual(await h.snapshot(),committed);
  });
  test(`${platform} gateway unavailable/upstream failure never confirms or executes correction`,async t=>{
    const h=await fixture(t,{gateway:true,platform}),before=await h.snapshot();
    h.state.ready=false;const boot=await h.adjust();assert.equal(boot.status,503);assert.equal(boot.body.ok,undefined);
    assert.equal(h.connections,0);assert.deepEqual(await h.snapshot(),before);
    h.state.ready=true;await h.stopUpstream();const failed=await h.adjust();assert.equal(failed.status,502);
    assert.equal(failed.body.ok,undefined);assert.equal(h.connections,0);assert.deepEqual(await h.snapshot(),before);
  });
}

for(const platform of ['telegram','vk']) {
  test(`${platform} correction cancellation is unsupported and original replay remains confirmed without data changes`,async t=>{
    const h=await fixture(t,{gateway:true,platform});
    for(const [amount,key] of [[25,'correction-credit-key'],[-10,'correction-debit-key']]) {
      const patch={amount,requestKey:key};assert.equal((await h.adjust(patch)).status,200);
      const before=await h.snapshot(),row=before.journal.find(r=>r.request_key===key);
      const denied=await h.cancel(String(row.id),{requestKey:`cancel-${key}`});
      assert.equal(denied.status,400);assert.match(denied.body.error,/нельзя отменить/);
      assert.equal(denied.body.ok,undefined);assert.deepEqual(await h.snapshot(),before);
      assert.equal((await h.cancel(String(row.id),{requestKey:`cancel-${key}`})).status,400);
      const replay=await h.adjust(patch);assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);
      assert.equal(replay.body.balance,Number(row.balance_after));assert.deepEqual(await h.snapshot(),before);
      assert.equal(row.status,'completed');assert.equal(row.cancel_request_key,null);assert.equal(row.cancelled_by,null);
      assert.equal(row.cancel_reason,null);assert.equal(row.cancelled_at,null);
    }
  });
  test(`${platform} unsupported correction cancellation preserves access and input rejection`,async t=>{
    const h=await fixture(t,{gateway:true,platform});await h.adjust();const before=await h.snapshot(),id=String(before.journal[0].id);
    for(const [patch,token,status] of [[{},'',401],[{},`${platform}:12`,403],[{reason:'x'},undefined,400],
      [{requestKey:''},undefined,400]]) {
      const count=h.connections;assert.equal((await h.cancel(id,patch,token)).status,status);
      assert.equal(h.connections,count);assert.deepEqual(await h.snapshot(),before);
    }
    assert.equal((await h.cancel('999')).status,404);assert.deepEqual(await h.snapshot(),before);
  });
}
