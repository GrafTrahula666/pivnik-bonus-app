import assert from 'node:assert/strict';
import http from 'node:http';
import {gzipSync,deflateSync} from 'node:zlib';
import test from 'node:test';
import express from 'express';

test('Express JSON parser survives compressed trailing bytes and preserves normal requests and limits', {timeout:10000}, async()=>{
const app=express();app.use(express.json({limit:'1mb'}));
app.post('/echo',(req,res)=>res.json(req.body));app.get('/health',(req,res)=>res.json({ok:true}));
app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.type||'parse_failed'}));
const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port;
const input={amount:125,customer:'fixture-only'};const json=Buffer.from(JSON.stringify(input));
try{
 for(const [encoding,body] of [['identity',json],['gzip',gzipSync(json)],['deflate',deflateSync(json)]]){
  const response=await fetch(url+'/echo',{method:'POST',headers:{'content-type':'application/json','content-encoding':encoding},body});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),input);console.log(encoding,'normal JSON pass');
 }
 for(const [encoding,compress] of [['gzip',gzipSync],['deflate',deflateSync]]){
  const body=Buffer.concat([compress(json),Buffer.from([0]),Buffer.alloc(100*1024,0x58)]);
  const response=await fetch(url+'/echo',{method:'POST',headers:{'content-type':'application/json','content-encoding':encoding},body});
  assert.ok([200,400].includes(response.status));await response.text();
  const health=await fetch(url+'/health');assert.equal(health.status,200);assert.deepEqual(await health.json(),{ok:true});
  console.log(encoding,'trailing bytes: process and health survived');
 }
 const oversized=await fetch(url+'/echo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({value:'x'.repeat(1024*1024)})});
 assert.equal(oversized.status,413);console.log('existing 1mb JSON limit preserved');
 const malformed=await fetch(url+'/echo',{method:'POST',headers:{'content-type':'application/json'},body:'{nope'});assert.equal(malformed.status,400);console.log('invalid JSON rejected');

}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}

});
