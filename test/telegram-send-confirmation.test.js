import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { createBroadcastCampaignStore } from '../broadcast-campaign-store.js';

const source=await readFile(new URL('../server.js',import.meta.url),'utf8');
function slice(start,end) {
  const a=source.indexOf(start), b=source.indexOf(end,a);
  assert.ok(a>=0 && b>a);
  return source.slice(a,b);
}
function runtime(fetchImpl, extras={}) {
  const context=vm.createContext({botToken:'fixture-token',fetch:fetchImpl,AbortSignal,
    console:{error(){},info(){}},setTimeout:callback=>{callback();}, ...extras});
  vm.runInContext(slice('const TELEGRAM_SEND_TIMEOUT_MS','async function sendVkCommunityMessage')
    +slice('const BROADCAST_CHANNELS','async function getBroadcastRecipients')
    +slice('function uniqueRecipientIds','function transactionResponse')
    +';globalThis.sender=sendTelegramMessage;globalThis.deliver=deliverBroadcast;',context);
  return context;
}
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});

test('Telegram sender accepts only confirmed success, rejects ambiguous bodies without retry',async()=>{
  for(const value of [null,[],true,{}, {ok:1,result:{message_id:7}}, {ok:true},
    {ok:true,result:{message_id:null}}, {ok:true,result:{message_id:'7'}},
    {ok:true,result:{message_id:-1}}, {ok:true,result:{message_id:1.5}},
    {ok:true,result:{message_id:Number.MAX_SAFE_INTEGER+1}}]) {
    let calls=0;
    const c=runtime(async()=>{calls++;return json(value);});
    const result=await c.sender('100','fixture');
    assert.equal(result.ok,false);assert.equal(result.error,'telegram_invalid_response');
    assert.equal(result.status,200);assert.equal(calls,1);
  }
  for(const body of ['<html>private fixture-token</html>','{"ok":','']) {
    let calls=0;
    const result=await runtime(async()=>{calls++;return new Response(body);}).sender('100','fixture');
    assert.equal(result.error,'telegram_invalid_response');assert.equal(calls,1);
    assert.ok(!JSON.stringify(result).includes('fixture-token'));
  }
  for(const id of [0,7,Number.MAX_SAFE_INTEGER]) {
    const c=runtime(async(url,options)=>{
      assert.equal(url,'https://api.telegram.org/botfixture-token/sendMessage');
      assert.equal(options.method,'POST');assert.ok(options.signal);
      assert.deepEqual(JSON.parse(options.body),{chat_id:'100',text:'fixture'});
      return json({ok:true,result:{message_id:id}});
    });
    const result=await c.sender('100','fixture');
    assert.equal(result.ok,true);assert.equal(result.messageId,id);
  }
  let calls=0;
  const unavailable=runtime(async()=>{calls++;throw Error('fixture-token');},{botToken:''});
  assert.equal((await unavailable.sender('100','fixture')).error,'telegram_not_configured');
  assert.equal(calls,0);
});

test('Telegram confirmed-response guard preserves bounded 429 retry and no network retry',async()=>{
  let calls=0;
  const c=runtime(async()=>{
    calls++;
    return calls===1 ? new Response(JSON.stringify({ok:false,parameters:{retry_after:1}}),{status:429})
      : json({ok:true,result:{message_id:7}});
  });
  assert.equal((await c.sender('100','fixture')).ok,true);assert.equal(calls,2);
  for(const retryAfter of [1,16,0,'bad']) {
    let attempts=0;
    const result=await runtime(async()=>{attempts++;return new Response(JSON.stringify({ok:false,
      parameters:{retry_after:retryAfter}}),{status:429});}).sender('100','fixture');
    assert.equal(result.ok,false);assert.equal(attempts,retryAfter===1?2:1);
  }
  for(const status of [401,403,500]) {
    let attempts=0;
    const result=await runtime(async()=>{attempts++;return new Response('bad',{status});}).sender('100','fixture');
    assert.equal(result.ok,false);assert.equal(attempts,1);
  }
  let attempts=0;
  const result=await runtime(async()=>{attempts++;throw Error('fixture-token');}).sender('100','fixture');
  assert.equal(result.error,'telegram_network_error');assert.equal(attempts,1);
});

test('actual broadcast handler persists confirmed counts and deduplicates ambiguous sends',async()=>{
  const db=new PGlite();
  let server;
  try {
    await db.exec('CREATE TABLE users(id BIGINT PRIMARY KEY); INSERT INTO users VALUES(1);');
    const query=async(sql,args)=>{
      if(sql.includes('pg_advisory_xact_lock')) return {rows:[],rowCount:1};
      const result=await db.query(sql,args);
      return {...result,rowCount:result.affectedRows || result.rows.length};
    };
    const store=createBroadcastCampaignStore({query,connect:async()=>({query,release(){}})});
    await store.ensureSchema();
    let calls=0;
    const app=express();app.use(express.json());
    const context=runtime(async()=>{calls++;return calls===1 ? json({ok:true,result:{message_id:7}})
      : new Response('<html>upstream error</html>');},{app,broadcastCampaignStore:store,
      vkCommunityId:'',vkCommunityToken:'',
      authRequired:(req,res,next)=>{
        if(!req.headers['x-fixture-role']) return res.status(401).json({error:'fixture auth required'});
        req.user={id:'1',role:req.headers['x-fixture-role']};next();
      },
      requireRole:role=>(req,res,next)=>req.user.role===role?next():res.status(403).json({error:'denied'}),
      getBroadcastRecipients:async()=>({rows:[{telegram_id:'100'},{telegram_id:'200'}],truncated:false})});
    vm.runInContext(slice("app.post('/api/admin/broadcast',","app.get('/api/admin/users',"),context);
    app.use((error,req,res,next)=>res.status(500).json({error:'fixture error'}));
    server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
    const url=`http://127.0.0.1:${server.address().port}/api/admin/broadcast`;
    const send=(role,body)=>fetch(url,{method:'POST',headers:{'content-type':'application/json',
      ...(role?{'x-fixture-role':role}:{})},body:JSON.stringify(body)});
    const body={channel:'telegram',audience:'clients',message:'fixture campaign'};
    for(const [role,input,status] of [[null,body,401],['viewer',body,403],['staff',body,403],
      ['admin',{...body,message:''},400],['admin',{...body,channel:'wrong'},400],
      ['admin',{...body,audience:'wrong'},400]]) {
      const response=await send(role,input);assert.equal(response.status,status);await response.json();
    }
    assert.equal(calls,0);
    assert.equal((await db.query('SELECT * FROM broadcast_campaigns')).rows.length,0);
    const response=await send('admin',body);assert.equal(response.status,200);
    const sent=await response.json();assert.equal(sent.telegram.delivered,1);assert.equal(sent.telegram.failed,1);
    assert.deepEqual(sent.telegram.errors,[{error:'telegram_invalid_response',count:1}]);
    const before=(await db.query('SELECT * FROM broadcast_campaigns')).rows;
    assert.equal(before[0].telegram_delivered,1);assert.equal(before[0].telegram_failed,1);
    const replay=await send('admin',body);assert.equal(replay.status,200);
    const repeated=await replay.json();assert.equal(repeated.deduplicated,true);
    assert.equal(repeated.campaignId,sent.campaignId);assert.equal(repeated.telegram.delivered,1);
    assert.equal(repeated.telegram.failed,1);assert.equal(calls,2);
    assert.deepEqual((await db.query('SELECT * FROM broadcast_campaigns')).rows,before);
  } finally {
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    await db.close();
  }
});
