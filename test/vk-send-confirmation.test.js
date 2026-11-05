import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';
const source=await readFile(new URL('../server.js',import.meta.url),'utf8');
const start=source.indexOf('async function sendVkCommunityMessage');
const end=source.indexOf('const BROADCAST_CHANNELS',start);assert.ok(start>=0&&end>start);
function sender(fetch,extra={}){const context=vm.createContext({vkCommunityToken:'fixture-token',vkCommunityId:'1',vkApiVersion:'5.199',URLSearchParams,crypto,fetch,console:{error(){}},...extra});vm.runInContext(source.slice(start,end)+';globalThis.send=sendVkCommunityMessage',context);return context.send;}

test('single-recipient VK sends require a safe non-negative message ID without retry',async()=>{
  for(const value of [null,[],true,{}, {response:null},{response:'7'},{response:{}},{response:[]},{response:[{peer_id:1910,message_id:7}]},{response:-1},{response:1.5},{response:Number.MAX_SAFE_INTEGER+1}]){
    let calls=0;const result=await sender(async()=>{calls++;return new Response(JSON.stringify(value));})('1910','fixture');
    assert.equal(result.ok,false);assert.equal(result.error,'vk_invalid_response');assert.equal(result.status,200);assert.equal(calls,1);
  }
  for(const body of ['<html>fixture-token</html>','{"response":','']){let calls=0;const result=await sender(async()=>{calls++;return new Response(body);})('1910','fixture');assert.equal(result.error,'vk_invalid_response');assert.equal(calls,1);assert.ok(!JSON.stringify(result).includes('fixture-token'));}
  for(const id of [0,7,Number.MAX_SAFE_INTEGER]){
    const result=await sender(async(url,options)=>{assert.equal(url,'https://api.vk.com/method/messages.send');assert.equal(options.method,'POST');assert.equal(options.body.get('user_id'),'1910');assert.equal(options.body.get('message'),'fixture');assert.equal(options.body.get('access_token'),'fixture-token');assert.equal(options.body.get('v'),'5.199');assert.ok(Number(options.body.get('random_id'))>0);return new Response(JSON.stringify({response:id}));})('1910','fixture');assert.equal(result.ok,true);assert.equal(result.messageId,id);
  }
});

test('VK confirmation guard preserves missing configuration and provider/network failure behavior',async()=>{
  for(const config of [{vkCommunityToken:''},{vkCommunityId:''}]){let calls=0;const result=await sender(async()=>{calls++;throw Error('unused');},config)('1910','fixture');assert.equal(result.error,'vk_not_configured');assert.equal(calls,0);}
  for(const status of [401,403,429,500]){let calls=0;const result=await sender(async()=>{calls++;return new Response(JSON.stringify({error:{error_code:901,error_msg:'vk_901'}}),{status});})('1910','fixture');assert.equal(result.ok,false);assert.equal(result.error,'vk_901');assert.equal(calls,1);}
  const refused=await sender(async()=>new Response(JSON.stringify({error:{error_code:901,error_msg:'vk_901'},response:7})))('1910','fixture');assert.equal(refused.ok,false);
  let calls=0;const disconnected=await sender(async()=>{calls++;throw Error('fixture-token');})('1910','fixture');assert.equal(disconnected.error,'vk_network_error');assert.equal(calls,1);assert.ok(!JSON.stringify(disconnected).includes('fixture-token'));
});
