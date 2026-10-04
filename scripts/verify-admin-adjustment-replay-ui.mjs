// Manual browser/HTTP/SQL verifier. No production startup, external sends or draft imports.
// Requires externally installed Playwright; optional Chromium executable as argv[2].
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import httpTransport from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { normalizeRequestKey } from '../platform-core.js';
import { createAdminAdjustmentPersistence } from '../admin-adjustment-persistence.js';
const { chromium } = createRequire(import.meta.url)('playwright');
const root=path.resolve(new URL('../',import.meta.url).pathname);
const out=path.resolve(process.argv[3]||path.join(root,'../adjust-replay-ui-checks'));
await mkdir(out,{recursive:true});
const client=await readFile(path.join(root,'app.js'),'utf8');
const gateway=await readFile(path.join(root,'universal-server.js'),'utf8');
const between=(s,a,b)=>{const i=s.indexOf(a),j=s.indexOf(b,i);assert.ok(i>=0&&j>i);return s.slice(i,j);};
// Reuse this PR's existing real route/SQL fixture without registering its node:test cases.
const fixtureText=await readFile(path.join(root,'test/admin-adjustment-replay-status.integration.test.js'),'utf8');
const prefix=between(fixtureText,'const gatewaySource =',"test('completed credit/debit").replaceAll('import.meta.url','moduleUrl');
const fixture=await new Function('readFile','moduleUrl','assert','PGlite','express','once','httpTransport',
  'normalizeRequestKey','createAdminAdjustmentPersistence',`return (async()=>{${prefix}\nreturn fixture;})();`)(
  readFile,pathToFileURL(path.join(root,'test/admin-adjustment-replay-status.integration.test.js')).href,
  assert,PGlite,express,once,httpTransport,normalizeRequestKey,createAdminAdjustmentPersistence);
let active,activeCleanup=[];
const proxyText=between(gateway,'async function readRequestBody(','export async function renderAppIndex(');
const proxyFactory=new Function('http','internalPort','childReady','MAX_BODY_BYTES','canonicalizeSessionToken',
  proxyText+'\nreturn proxyRequest;');
const shell=(await readFile(path.join(root,'index.html'),'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const server=httpTransport.createServer(async(req,res)=>{
  try {
    if(req.url.startsWith('/api/'))return active.proxy(req,res);
    const pathname=new URL(req.url,'http://localhost').pathname;
    const file=path.resolve(root,'.'+pathname);
    assert.ok(pathname==='/'||file.startsWith(root+path.sep));
    res.setHeader('content-type',pathname.endsWith('.css')?'text/css':pathname==='/'?'text/html':'application/octet-stream');
    res.end(pathname==='/'?shell:await readFile(file));
  }catch(error){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message}));}
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await chromium.launch({headless:true,...(process.argv[2]?{executablePath:process.argv[2]}:{})});
const results=[];
try {
  for(const platform of ['telegram','vk'])for(const width of [390,1440]) {
    const cleanup=activeCleanup=[],h=await fixture({after:fn=>cleanup.push(fn)},{platform});
    active={proxy:proxyFactory(httpTransport,h.state.port,true,1048576,async token=>({token,payload:{}}))};
    const owner=platform==='vk'?'11':'10';
    await h.adjust({},`${platform}:${owner}`);
    await h.db.exec("UPDATE transactions SET status='cancelled'");
    const before=await h.snapshot();
    const page=await browser.newPage({viewport:{width,height:1000}});
    let prompts=0;page.on('dialog',d=>{prompts++;return d.accept(d.message().startsWith('Изменение')?'25':'Replay status fixture');});
    await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});
    await page.evaluate(({platform,owner,usersSource,transactionSource,apiSource})=>{
      document.documentElement.classList.add(`platform-${platform}`);
      document.querySelector('#bootScreen')?.classList.add('hidden');
      const modal=document.querySelector('#adminUsersModal');modal.classList.add('open');modal.setAttribute('aria-hidden','false');
      const state={token:`${platform}:${owner}`,profile:{id:owner,role:'admin'}};
      const f={messages:[],refreshes:0,posts:0,state};
      const api=new Function('state','APP_VERSION','IS_VK','API_TIMEOUT_MS','delay','fetchWithTimeout',apiSource+'\nreturn api;')(
        state,'isolated-replay-ui',platform==='vk',3000,ms=>new Promise(r=>setTimeout(r,ms)),async(url,options)=>{
          f.posts++;const response=await fetch(url,options);const data=await response.json();return {response,data};
        });
      const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const toast=text=>{f.messages.push(text);const el=document.querySelector('#toast');el.textContent=text;el.classList.add('show');};
      const wire=new Function('state','$','api','prompt','requestId','toast','refreshAdminUsersDirectory','fmt','fmtLiters',
        'escapeHtml','compactBonus','roleCanWrite','ADMIN_CRM_STATUS_LABELS',usersSource+'\nreturn renderUsers;');
      const render=wire(state,s=>document.querySelector(s),api,window.prompt.bind(window),()=> 'replay-status-key',toast,
        async()=>{f.refreshes++;},String,String,escape,String,role=>role==='admin',{});
      f.render=render;f.api=api;
      const user={id:'20',name:'Тестовый клиент',role:'client',balance:100,telegramId:'123',crmStatus:'active',beerPaidLitersTotal:0,beerGiftLitersBalance:0};
      render([user],'#allUsersList');
      const html=new Function('state','fmt','fmtLiters','escapeHtml','roleCanWrite',transactionSource+'\nreturn adminTransactionHtml;')(
        state,String,String,escape,role=>role==='admin');
      const row={id:'1',clientName:'Тестовый клиент',staffName:'Владелец',createdAt:new Date().toISOString(),mode:'adjustment',status:'completed',bonusEarned:25,bonusSpent:0,checkAmount:0};
      const rendered=html(row);f.cancelHidden=!rendered.includes('data-admin-cancel');
      f.normalPurchaseCancelShown=html({...row,mode:'accrue'}).includes('data-admin-cancel');
      window.fixture=f;
    },{platform,owner,usersSource:between(client,'function adminCrmActivityMarkup(',"$('#openProfileSettings')"),
      transactionSource:between(client,'function adminTransactionHtml(','function bindAdminTransactionActions('),
      apiSource:between(client,'async function api(','function openModal(')});
    assert.equal(await page.evaluate(()=>fixture.cancelHidden),true);
    assert.equal(await page.evaluate(()=>fixture.normalPurchaseCancelShown),true);
    await page.locator('[data-adjust-user]').click();
    await page.waitForFunction(()=>fixture.messages.length===1);
    assert.match(await page.locator('#toast').textContent(),/больше не подтверждена/);
    assert.deepEqual(await page.evaluate(()=>({posts:fixture.posts,refreshes:fixture.refreshes})),{posts:1,refreshes:0});
    assert.deepEqual(await h.snapshot(),before);
    const box=await page.locator('[data-adjust-user]').boundingBox();assert.ok(box&&box.width>0&&box.x>=0&&box.x+box.width<=width);
    await page.screenshot({path:path.join(out,`${platform}-${width}-409.png`),fullPage:true});
    await page.evaluate(({platform})=>{fixture.state.token=`${platform}:12`;}, {platform});
    await page.locator('[data-adjust-user]').click();await page.waitForFunction(()=>fixture.messages.length===2);
    assert.match(await page.locator('#toast').textContent(),/Недостаточно прав/);
    assert.equal(await page.evaluate(()=>fixture.refreshes),0);assert.deepEqual(await h.snapshot(),before);
    assert.equal(prompts,4);
    results.push({platform,width,cancelActionHidden:true,completedPurchaseCancelAvailable:true,status409ErrorOnly:true,
      status403ErrorOnly:true,noRefreshOnDenial:true,snapshotsUnchanged:true,buttonWithinViewport:true});
    await page.close();for(const close of cleanup.reverse())await close();activeCleanup=[];
  }
  console.log(JSON.stringify({results,checks:results.length*7,signedProductionAuthorizationVerified:false,
    fullApplicationBootVerified:false,fetchTimeoutImplementationVerified:false},null,2));
}finally {for(const close of activeCleanup.reverse())await close();await browser.close();await new Promise(resolve=>server.close(resolve));}
