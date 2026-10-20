import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createPosHttp } from '../pos/http.js';
import { createPosDeviceService } from '../pos/devices.js';

const read=name=>readFile(new URL('../'+name,import.meta.url),'utf8');
function slice(text,a,b) {const start=text.indexOf(a),end=text.indexOf(b,start+1);assert.ok(start>=0&&end>start);return text.slice(start,end);}
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));

test('real gateway proxy sends both redemption transports/key to the canonical financial runtime, not its display policy',async()=>{
  const db=new PGlite();let main,gateway;
  try {
    await db.exec(await read('test/fixtures/evotor-redemption.sql'));
    for(const name of ['012_evotor_sales.sql','013_evotor_pos_scope_devices.sql','014_evotor_bonus_accrual.sql','023_evotor_redemptions.sql'])await db.exec(await read('migrations/'+name));
    await db.exec("INSERT INTO pos_store_bindings VALUES('bar','tenant','location',TRUE); INSERT INTO pos_operator_access VALUES(3,'bar',TRUE,NULL)");
    const pool={query:db.query.bind(db),connect:async()=>({query:db.query.bind(db),release(){}})};
    const config={enabled:true,bonusEnabled:true,redemptionEnabled:true,storeId:'bar'};
    const canonical=createPosHttp(pool,config,Date.now,{isUnlimited:()=>false,unlimitedBalance:9999999999999});
    const display=createPosHttp(pool,config,Date.now,{isUnlimited:()=>true,unlimitedBalance:9999999999999});
    const issued=await createPosDeviceService(pool,config).issue({id:'3',role:'admin',termsAccepted:true},{storeId:'bar',externalDeviceId:'one',label:'one'});
    main=http.createServer(async(req,res)=>{
      try {
        const chunks=[];for await(const chunk of req)chunks.push(chunk);
        const raw=Buffer.concat(chunks);
        const result=await canonical.device({method:req.method,pathname:req.url,authorization:req.headers.authorization,
          deviceKey:req.headers['x-pivnik-device-key'],body:raw.length?JSON.parse(raw):undefined});
        res.writeHead(200,{'Content-Type':'application/json','X-Canonical-Financial':'yes'});res.end(JSON.stringify(result));
      }catch(error){res.writeHead(error.statusCode||500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.code||'failed'}));}
    });await listen(main);
    const source=await read('universal-server.js');
    const helpers=slice(source,'async function readRequestBody(','\nasync function proxyRequest(');
    const proxy=slice(source,'async function proxyRequest(','\nexport async function renderAppIndex(');
    const routes=slice(source,"    if (url.pathname === '/api/device/pos/redemptions')",'\n    // Available even during DB startup;');
    const context=vm.createContext({Buffer,URL,http,console,MAX_BODY_BYTES:8192,childReady:true,internalPort:main.address().port,
      canonicalizeSessionToken:async()=>({payload:null}),posHttp:display,requestAddress:()=> 'loopback'});
    vm.runInContext(helpers+proxy+'\nthis.dispatch=async(req,res)=>{const url=new URL(req.url,"http://localhost");'+routes+'};this.sendFailure=(res,error)=>sendJson(res,error.statusCode||500,{error:error.code||error.message});',context);
    gateway=http.createServer((req,res)=>context.dispatch(req,res).catch(error=>context.sendFailure(res,error)));
    await listen(gateway);
    const base=`http://127.0.0.1:${gateway.address().port}`;
    const request=async(path,body,key=issued.deviceToken)=>{
      const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer evotor-fixture-token',
        ...(key?{'X-Pivnik-Device-Key':key}:{})},body:JSON.stringify(body)});
      return {status:response.status,canonical:response.headers.get('x-canonical-financial'),data:await response.json()};
    };
    const path='/api/device/pos/receipts/bind',receiptUuid='receipt-forward';
    assert.equal((await request(path,{receiptUuid,payload:'PVK-AAAA-2222'})).status,200);
    const quote={operation:'redemption',action:'quote',receiptUuid,clientId:'1',totalCents:100000,basketHash:'a'.repeat(64)};
    const quoted=await request(path,quote);
    assert.equal(quoted.status,200);assert.equal(quoted.canonical,'yes');
    assert.equal(quoted.data.unlimited,false);assert.equal(quoted.data.balance,1000);assert.equal(quoted.data.maxPoints,300);
    assert.equal((await request(path,quote,null)).status,401);
    const reserve={...quote,action:'reserve',operationId:randomUUID(),points:300};
    const first=await request(path,reserve);assert.equal(first.status,200);
    const retry=await request('/api/device/pos/redemptions',reserve);
    assert.equal(retry.status,200);assert.deepEqual(retry.data,first.data);
    assert.equal(Number((await db.query('SELECT balance FROM wallets WHERE user_id=1')).rows[0].balance),700);
    assert.equal((await request(path,{...quote,padding:'a'.repeat(8192)})).status,413);
  }finally{
    for(const server of [gateway,main])if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    await db.close();
  }
});
