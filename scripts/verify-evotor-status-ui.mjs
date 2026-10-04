// Manual browser diagnostic of pinned draft UI; no production app or network.
// Usage: node script.mjs /absolute/playwright/module /absolute/chromium [output-dir]
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
const pin='776c70d691540b01bbc56a1496203e6cc918eea6';
const root=path.resolve(new URL('../',import.meta.url).pathname);
const files=['pos-admin.js','pos-admin.css'];
const source=Object.fromEntries(files.map(file=>[file,execFileSync('git',['show',`${pin}:${file}`],{cwd:root,encoding:'utf8'})]));
const hashes=Object.fromEntries(files.map(file=>[file,createHash('sha256').update(source[file]).digest('hex')]));
assert.ok(process.argv[2]&&process.argv[3],'Pass external Playwright module and Chromium executable; no installation/fallback');
const {chromium}=createRequire(import.meta.url)(process.argv[2]);
const out=process.argv[4];if(out)await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.argv[3]});
const cases=[];
const empty={salesCents:'0',returnsCents:'0',netCents:'0',returnDocuments:0,receiptCount:0,saleDocuments:0,averageCents:null,activeBuyers:0,repeatBuyers:0,linkedSaleDocuments:0,unlinkedSaleDocuments:0,days:[],hours:[],products:[],payments:[]};
const states={not_connected:'Касса не подключена',schema_required:'Подключение ожидает подготовки базы',awaiting_sync:'Ожидаем первую полную синхронизацию',syncing:'Идёт сверка истории',connected:'Касса подключена',error:'Синхронизация остановлена'};
try {
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<style>body{margin:8px;font:16px sans-serif}*{box-sizing:border-box}</style><div data-screen="admin" class="active"><div id="posAdminMount"></div></div>');
  await page.addStyleTag({content:source['pos-admin.css']});
  await page.evaluate(()=>{window.state={profile:{role:'viewer'}};window.fixture={pending:true,requests:0};window.api=async()=>{fixture.requests++;if(fixture.pending)await new Promise(r=>fixture.resolve=r);if(fixture.error)throw Error(fixture.error);return fixture.response;};});
  await page.addScriptTag({content:source['pos-admin.js']});
  assert.match(await page.locator('#posConnection').innerText(),/Проверяем подключение/);cases.push({width,state:'loading'});
  const response=(state,metrics=null)=>({connection:{state,lastSuccessAt:metrics?new Date(Date.now()-11*60000).toISOString():null,errorCode:state==='error'?'token_expired':null},all:metrics,app:metrics,manual:{clients:0,operations:0,checkCents:'0'},documents:[],linkedRevenueSharePercent:null});
  const scenarios=Object.keys(states).map(state=>({state,value:response(state,['connected','error'].includes(state)?{...empty,salesCents:'1000',netCents:'1000',receiptCount:1,saleDocuments:1,averageCents:'1000'}:null)}));
  scenarios.push({state:'syncing',value:response('syncing',{...empty,salesCents:'1000',netCents:'1000'})},{state:'connected',value:response('connected',empty)});
  for(let i=0;i<scenarios.length;i++){
   const {state,value}=scenarios[i];await page.evaluate(({value,first})=>{fixture.response=value;fixture.error=null;if(first){fixture.pending=false;fixture.resolve();}}, {value,first:i===0});
   if(i)await page.locator('#posRefresh').click();
   await page.waitForFunction(text=>document.querySelector('#posConnection').textContent.includes(text),states[state]);
   for(const tab of ['app','all']){
    await page.locator(`[data-pos-tab="${tab}"]`).click();const status=await page.locator('#posConnection').innerText(),result=await page.locator('#posResult').innerText();assert.ok(status.includes(states[state]));
    if(!value.all){assert.match(result,/Кассовая выручка пока не доступна/);assert.equal(await page.locator('.pos-metric').count(),0);}else{assert.ok(await page.locator('.pos-metric').count()>0);assert.match(status,/больше 10 минут/);if(value.all.salesCents==='1000')assert.match(result,/10,00 ₽/);else assert.match(result,/0,00 ₽/);}
    if(state==='error')assert.match(status,/Токен истёк или отозван/);
    if(tab==='app')assert.match(result,/Записи сотрудников не подтверждены кассой/);
    assert.equal(await page.locator('#posSync').isVisible(),false);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page overflow');cases.push({width,state,tab,metrics:value.all?'available':'null'});
   }
  }
  for(const error of ['Недостаточно прав.','Облако недоступно']){await page.evaluate(error=>fixture.error=error,error);await page.locator('#posRefresh').click();await page.waitForFunction(error=>document.querySelector('#posConnection').textContent===error,error);assert.equal(await page.locator('#posResult').innerText(),'');cases.push({width,state:error});}
  await page.evaluate(value=>{
    state.profile.role='admin';fixture.error=null;fixture.response=value;fixture.posts=[];
    window.api=async(path,options)=>{
      if(path==='/api/admin/pos/sync'){
        fixture.posts.push({path,options});
        await new Promise(r=>fixture.syncResolve=r);
        if(fixture.syncError)throw Error(fixture.syncError);
        return fixture.syncResult;
      }
      if(fixture.error)throw Error(fixture.error);
      return fixture.response;
    };
  },response('connected',{...empty,salesCents:'1000',netCents:'1000'}));
  await page.locator('#posRefresh').click();await page.waitForFunction(()=>!document.querySelector('#posSync').hidden);assert.equal(await page.locator('#posSync').isVisible(),true);cases.push({width,state:'owner-sync-visible'});
  const syncScenario=async(name,result,error=null,refreshError=null)=>{
    await page.evaluate(({result,error})=>{fixture.error=null;fixture.syncResult=result;fixture.syncError=error;fixture.syncResolve=null;},{result,error});
    const before=await page.evaluate(()=>fixture.posts.length);
    await page.locator('#posSync').click();await page.waitForFunction(()=>typeof fixture.syncResolve==='function');
    assert.equal(await page.locator('#posSync').isDisabled(),true);
    await page.evaluate(()=>document.querySelector('#posSync').click());
    assert.equal(await page.evaluate(()=>fixture.posts.length),before+1);
    const post=await page.evaluate(()=>fixture.posts.at(-1));assert.equal(post.options.method,'POST');assert.equal(post.options.retries,0);assert.equal(post.options.timeoutMs,20000);
    await page.evaluate(refreshError=>{fixture.error=refreshError;fixture.syncResolve();},refreshError);
    await page.waitForFunction(()=>!document.querySelector('#posSync').disabled);
    const text=await page.locator('#posConnection').innerText();
    if(error)assert.equal(text,error);else if(refreshError){assert.equal(text,refreshError);assert.equal(await page.locator('#posResult').innerText(),'');}
    else if(!result.complete&&!result.busy)assert.match(text,/История ещё загружается/);
    else assert.ok(!text.includes('История ещё загружается'));
    if(!refreshError)assert.match(await page.locator('#posResult').innerText(),/10,00 ₽/);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));cases.push({width,state:name});
  };
  await syncScenario('complete-sync-one-post',{complete:true,busy:false});
  await syncScenario('partial-sync-next-page-hint',{complete:false,busy:false});
  await syncScenario('busy-sync-no-completion-claim',{complete:false,busy:true});
  await syncScenario('provider-refusal-reenables-button',null,'Токен истёк или отозван');
  await syncScenario('permission-refusal-reenables-button',null,'Недостаточно прав.');
  await syncScenario('network-refusal-reenables-button',null,'Облако недоступно');
  await syncScenario('sync-accepted-but-refresh-failed',{complete:true,busy:false},null,'Не удалось загрузить дашборд');
  assert.deepEqual(errors,[]);if(out)await page.screenshot({path:path.join(out,`error-${width}.png`),fullPage:true});await page.close();
 }
 console.log(JSON.stringify({pin,sourceSha256:hashes,browserCases:cases.length,cases,fullAppBootVerified:false,productionAuthorizationVerified:false,responseFixtures:true},null,2));
}finally{await browser.close();}
