import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createBroadcastCampaignStore} from '../broadcast-campaign-store.js';

test('broadcast SQL upgrade preserves legacy rows; new errors survive completion and replay',async()=>{
  const db=new PGlite();
  try {
    await db.exec('CREATE TABLE users(id BIGINT PRIMARY KEY); INSERT INTO users VALUES(7);');
    const statements=[];
    await createBroadcastCampaignStore({query:async sql=>{statements.push(sql);return{rows:[],rowCount:0};},connect:async()=>{throw Error('unused');}}).ensureSchema();
    // A pre-upgrade schema and completed campaign, only in this isolated database.
    await db.exec(statements[0].replace('telegram_errors JSONB,','').replace('vk_errors JSONB,',''));
    await db.exec("INSERT INTO broadcast_campaigns(actor_user_id,channel,audience,message_hash,fingerprint,status,total_users,telegram_attempted,telegram_delivered,telegram_failed) VALUES(7,'telegram','clients','legacy','legacy','completed',2,2,1,1)");
    const legacyBefore=(await db.query('SELECT * FROM broadcast_campaigns')).rows[0];
    let unavailable=false, calls=0;
    const pool={async query(sql,params){calls++;if(unavailable)throw Error('fixture unavailable');if(sql.includes('pg_advisory_xact_lock'))return{rows:[],rowCount:1};const r=params?.length?await db.query(sql,params):(await db.exec(sql)).at(-1)||{rows:[]};return{...r,rowCount:Math.max(r.affectedRows||0,r.rows.length)};},async connect(){return{query:this.query.bind(this),release(){}};}};
    const store=createBroadcastCampaignStore(pool);
    await store.ensureSchema();await store.ensureSchema();
    const legacyAfter=(await db.query('SELECT * FROM broadcast_campaigns WHERE id=1')).rows[0];
    const {telegram_errors,vk_errors,...legacyFields}=legacyAfter;
    assert.deepEqual(legacyFields,legacyBefore);assert.equal(telegram_errors,null);assert.equal(vk_errors,null);
    const claims={actorUserId:7,channel:'all',audience:'clients',message:'Fixture message never persisted',totalUsers:4,truncated:false};
    const claim=await store.claim(claims);assert.equal(claim.created,true);
    const outcome={telegram:{attempted:4,delivered:2,failed:2,errors:[{error:'telegram_network_error',count:1},{error:'telegram_send_failed',count:1}]},vk:{attempted:4,delivered:3,failed:1,errors:[{error:'vk_901',count:1}]}};
    unavailable=true;await assert.rejects(store.complete(claim.campaign.id,outcome),/fixture unavailable/);unavailable=false;
    assert.equal((await db.query('SELECT status FROM broadcast_campaigns WHERE id=$1',[claim.campaign.id])).rows[0].status,'processing');
    const completed=await store.complete(claim.campaign.id,outcome);
    assert.deepEqual(completed.telegram.errors,outcome.telegram.errors);assert.deepEqual(completed.vk.errors,outcome.vk.errors);
    const beforeReplay=(await db.query('SELECT * FROM broadcast_campaigns ORDER BY id')).rows;
    const replay=await store.claim(claims);assert.equal(replay.created,false);assert.deepEqual(replay.campaign,completed);
    assert.deepEqual((await db.query('SELECT * FROM broadcast_campaigns ORDER BY id')).rows,beforeReplay);
    const beforeInvalid=calls;await assert.rejects(store.complete('bad',outcome),TypeError);await assert.rejects(store.claim({...claims,channel:'invalid'}),TypeError);assert.equal(calls,beforeInvalid);
    const legacyPool={query:pool.query.bind(pool),async connect(){return{query:async sql=>sql.includes('FROM broadcast_campaigns')?{rows:[legacyAfter],rowCount:1}:{rows:[],rowCount:0},release(){}};}};
    const legacy=await createBroadcastCampaignStore(legacyPool).claim(claims);assert.equal(legacy.campaign.telegram.errors,null);
  } finally {await db.close();}
});

test('broadcast error summary is bounded and excludes provider text, identifiers and unsafe counts',async()=>{
  let parameters;
  const store=createBroadcastCampaignStore({async query(sql,params){parameters=params;return{rowCount:1,rows:[{id:1,actor_user_id:7,status:'completed',telegram_failed:params[3],vk_failed:params[6],telegram_errors:JSON.parse(params[7]),vk_errors:JSON.parse(params[8])}]};},async connect(){throw Error('unused');}});
  const completed=await store.complete(1,{telegram:{failed:3,errors:[null,{error:'fixture-token secret user 123',count:1,chat_id:'123'},{error:'telegram_network_error',count:20},{error:'telegram_invalid_response',count:1}]},vk:{failed:2,errors:[{error:'vk_network_error',count:1.5},{error:'secret',count:-1},{error:'vk_901',count:1},{error:'vk_901',count:1},{error:'vk_902',count:9}]}});
  assert.deepEqual(completed.telegram.errors,[{error:'telegram_send_failed',count:1},{error:'telegram_network_error',count:2}]);
  assert.deepEqual(completed.vk.errors,[{error:'vk_901',count:2}]);assert.doesNotMatch(JSON.stringify(parameters),/fixture-token|secret|chat_id|123/);
  assert.ok(Object.isFrozen(completed.telegram.errors));assert.ok(Object.isFrozen(completed.telegram.errors[0]));
  const bounded=await store.complete(1,{telegram:{failed:100,errors:Array.from({length:20},()=>({error:'telegram_network_error',count:1}))},vk:{failed:0,errors:[{error:'vk_network_error',count:1}]}});
  assert.deepEqual(bounded.telegram.errors,[{error:'telegram_network_error',count:8}]);assert.deepEqual(bounded.vk.errors,[]);
  const unknown=await store.complete(1,{telegram:{failed:2,errors:{error:'telegram_network_error',count:2}}});assert.equal(unknown.telegram.errors,null);
});
