import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
const start=source.indexOf('function timeoutError('),end=source.indexOf('function openModal(',start);
assert.ok(start>=0&&end>start);
function client(response){
 const calls=[];const context={AbortController,Error,Promise,setTimeout,clearTimeout,APP_VERSION:'test',IS_VK:false,API_TIMEOUT_MS:1000,state:{token:'fixture'},delay:async()=>{},fetch:async(path,options)=>{calls.push({path,options});return response;}};
 vm.runInNewContext(source.slice(start,end)+'\nglobalThis.callApi=api;',context);return {api:context.callApi,calls};
}
for(const keyed of [false,true])test(`HTTP 200 malformed JSON rejects ${keyed?'keyed':'ordinary'} POST without retry`,async()=>{
 const c=client({ok:true,status:200,json:async()=>{throw new SyntaxError('truncated');}});
 const body=JSON.stringify({documentId:'sale',qr:'fixture',...(keyed?{requestKey:'original'}:{})});
 await assert.rejects(c.api('/api/admin/pos/link',{method:'POST',body}),e=>e.code==='INVALID_RESPONSE'&&e.status===200);
 assert.equal(c.calls.length,1);assert.equal(c.calls[0].options.body,body);
});
test('Valid HTTP 200 JSON retains confirmed result',async()=>{
 const data={ok:true,clientId:'1'};const c=client({ok:true,status:200,json:async()=>data});assert.equal(await c.api('/api/admin/pos/link',{method:'POST'}),data);assert.equal(c.calls.length,1);
});
test('Non-JSON HTTP 403 keeps access-denied status without retry',async()=>{
 const c=client({ok:false,status:403,json:async()=>{throw new SyntaxError('html');}});
 await assert.rejects(c.api('/api/admin/pos/link',{method:'POST',body:'{"requestKey":"original"}'}),e=>e.status===403&&e.message==='Ошибка 403');assert.equal(c.calls.length,1);
});
