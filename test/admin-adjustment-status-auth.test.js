import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminAdjustmentStatusAuth } from '../admin-adjustment-status-auth.js';

function response() {
  return { statusCode:200, set() {return this;}, status(n) {this.statusCode=n;return this;}, json(body) {this.body=body;return this;} };
}
const payload = {uid:'10',sv:1,platform:'vk',role:'admin',platformRole:'platform_admin'};

test('Status auth requires explicit functions/boolean and is disabled by default', async () => {
  assert.throws(()=>createAdminAdjustmentStatusAuth(),TypeError);
  assert.throws(()=>createAdminAdjustmentStatusAuth({query(){},verifySession(){},readOnlyIdentityEnabled:'true'}),TypeError);
  let calls=0;
  const auth=createAdminAdjustmentStatusAuth({query(){calls++;},verifySession(){calls++;}});
  const req={headers:{authorization:'Bearer fixture'},user:{id:'spoof'},session:{uid:'spoof'}}, res=response();
  await auth(req,res,()=>assert.fail('disabled middleware continued'));
  assert.equal(res.statusCode,503); assert.equal(calls,0); assert.equal(req.user,undefined); assert.equal(req.session,undefined);
});

test('Status auth rejects malformed driver evidence and propagates outages without an identity', async () => {
  for (const result of [{}, {rows:[{id:'11',session_version:1}]}, {rows:[{id:'10',session_version:'bad'}]},
    {rows:[{id:'10',session_version:1},{id:'10',session_version:1}]}]) {
    const auth=createAdminAdjustmentStatusAuth({query:async()=>result,verifySession:()=>payload,readOnlyIdentityEnabled:true});
    const req={headers:{authorization:'Bearer fixture'},user:{id:'spoof'}},res=response();let error;
    await auth(req,res,e=>{error=e;}); assert.ok(error instanceof Error); assert.equal(req.user,undefined);
  }
  const outage=Error('SQL down');let received;
  const auth=createAdminAdjustmentStatusAuth({query:async()=>{throw outage;},verifySession:()=>payload,readOnlyIdentityEnabled:true});
  await auth({headers:{authorization:'Bearer fixture'}},response(),e=>{received=e;});
  assert.equal(received,outage);
});

test('Status auth publishes only frozen signed identity from one parameterized SELECT', async () => {
  const calls=[];
  const auth=createAdminAdjustmentStatusAuth({query:async(sql,params)=>{calls.push({sql,params});return {rows:[{id:'10',session_version:'1',role:'admin',platformRole:'platform_admin'}]};},
    verifySession:()=>payload,readOnlyIdentityEnabled:true});
  const req={headers:{authorization:'Bearer fixture'},body:{userId:'11',platformRole:'platform_admin'}};let continued=false;
  await auth(req,response(),error=>{assert.equal(error,undefined);continued=true;});
  assert.equal(continued,true); assert.deepEqual(req.user,{id:'10'});
  assert.deepEqual(req.session,{uid:'10',sv:1,platform:'vk'});
  assert.ok(Object.isFrozen(req.user));assert.ok(Object.isFrozen(req.session));
  assert.equal(calls.length,1);assert.deepEqual(calls[0].params,['10']);
  assert.match(calls[0].sql,/^SELECT id, session_version FROM users/);
  assert.doesNotMatch(calls[0].sql,/INSERT|UPDATE|DELETE/);
});
