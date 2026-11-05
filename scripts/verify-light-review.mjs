import fs from 'node:fs/promises';import http from 'node:http';import path from 'node:path';import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root=process.cwd(), mode='light',out=path.join(root,'artifacts','light-review');await fs.mkdir(out,{recursive:true});
const app=await fs.readFile(root+'/app.js','utf8');
const index=(await fs.readFile(root+'/index.html','utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</head>','<link rel="stylesheet" href="/loader-fix.css"></head>');
const server=http.createServer(async(req,res)=>{const file=new URL(req.url,'http://local').pathname;try{if(file.includes('..'))throw Error();res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.html')||file==='/'?'text/html':file.endsWith('.png')?'image/png':file.endsWith('.webp')?'image/webp':file.endsWith('.svg')?'image/svg+xml':'text/javascript');res.end(file==='/'?index:await fs.readFile(root+file));}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox','--disable-dev-shm-usage']} : {})});
const results=[];
try{for(const platform of ['telegram','vk'])for(const width of [375,430]){
 const page=await browser.newPage({viewport:{width,height:932},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.evaluate(p=>document.documentElement.classList.add('platform-'+p),platform);
 if(mode==='light')await page.screenshot({path:`${out}/light-${platform}-${width}-boot.png`});
 const renderer=app.slice(app.indexOf('function avatarAssetUrl'),app.indexOf('function profileDraftFromCurrent'));
 await page.addScriptTag({content:`const escapeHtml=v=>String(v).replace(/[&<>"']/g,'');${renderer}`});
 if(mode==='light'){
 const design=app.slice(app.indexOf('function applyDesign('),app.indexOf('function renderBeer('));
 await page.addScriptTag({content:`const state={};const deepClone=v=>JSON.parse(JSON.stringify(v));const $=s=>document.querySelector(s);const tg=null;const TELEGRAM_HEADER_COLOR='#0b0e13';${design}`});
 await page.evaluate(()=>{document.documentElement.classList.add('theme-halloween');applyDesign({theme:'halloween',sections:{},texts:{}});});
 }
 await page.evaluate(mode=>{
 document.querySelector('#bootScreen').remove(); document.querySelector('#appShell').classList.remove('hidden');
 document.querySelector('#clientName').textContent='Кирилл';document.querySelector('#clientBalance').textContent='1 250';document.querySelector('#statusName').textContent='Золотой';document.querySelector('#homeWheelStatus').textContent='ДОСТУПНО';
 renderAvatarInto(document.querySelector('#profileAvatar'),{profileFrame:mode==='dragon'?'creator-violet':'none',avatarSource:'preset_male'});
 document.querySelectorAll('.modal,.promo-banner').forEach(e=>e.classList.remove('open'));
 },mode);
 await page.waitForTimeout(800);
 if(mode==='light'){
 const result=await page.evaluate(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};};return {night:document.documentElement.classList.contains('theme-halloween'),wheel:rect('.home-wheel-card'),run:rect('.home-run-card'),home:rect('.client-home'),scroll:document.documentElement.scrollWidth,bg:getComputedStyle(document.querySelector('.app-shell'),'::before').backgroundImage};});
 assert(!result.night);assert.equal(result.wheel.y,result.run.y);assert(Math.abs(result.wheel.w-result.run.w)<1);assert(result.wheel.x>result.run.x);assert(result.scroll<=width);assert(result.bg.includes('spaceverse-cloud-city'));
 await page.screenshot({path:`${out}/light-${platform}-${width}-home.png`,fullPage:true});
 for(const screen of ['profile','league','wheel','actions']){
 await page.evaluate(target=>{document.querySelectorAll('.screen').forEach(e=>e.classList.toggle('active',e.dataset.screen===target));document.querySelector('#appShell').classList.toggle('wheel-mode',target==='wheel');},screen);
 await page.screenshot({path:`${out}/light-${platform}-${width}-${screen}.png`,fullPage:true});
 }
 results.push({platform,width,...result,errors});assert.equal(errors.length,0);
 }else{
 await page.evaluate(()=>{
 const box=document.createElement('div');box.id='dragon-test';box.style.cssText='position:fixed;inset:0;background:radial-gradient(circle at center,#25113f,#090716);display:grid;place-items:center;z-index:9999';box.innerHTML='<div style="position:relative;width:180px;height:180px" id="dragon-large"></div><div style="position:absolute;bottom:60px;width:44px;height:44px" id="dragon-small"></div>';document.body.append(box);
 renderAvatarInto(document.querySelector('#dragon-large'),{profileFrame:'creator-violet',avatarSource:'preset_male'});renderAvatarInto(document.querySelector('#dragon-small'),{profileFrame:'creator-violet',avatarSource:'preset_male'});
 });await page.waitForTimeout(600);
 assert.equal(await page.locator('#dragon-large .creator-dragon-ready').count(),1);
 if(width===430 && platform==='telegram'){
 await fs.mkdir(out+'/frames',{recursive:true});
 // Deterministic timestamps go through the actual requestAnimationFrame renderer.
 await page.evaluate(()=>{window.__raf=requestAnimationFrame;window.__cancel=cancelAnimationFrame;window.__callbacks=new Map();window.__next=10000;startCreatorDragonAnimation.runtime.last=-Infinity;cancelAnimationFrame(startCreatorDragonAnimation.runtime.raf);startCreatorDragonAnimation.runtime.raf=0;window.requestAnimationFrame=cb=>{const id=++window.__next;window.__callbacks.set(id,cb);return id;};window.cancelAnimationFrame=id=>window.__callbacks.delete(id);startCreatorDragonAnimation.runtime.wake();});
 for(let i=0;i<180;i++){
 await page.evaluate(ms=>{const callbacks=[...window.__callbacks.values()];window.__callbacks.clear();for(const cb of callbacks)cb(ms);},i*100);
 await page.screenshot({path:`${out}/frames/frame-${String(i).padStart(3,'0')}.png`});
 }
 }
 await page.screenshot({path:`${out}/dragon-${platform}-${width}.png`});
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(100);
 const reduced=await page.evaluate(()=>({raf:startCreatorDragonAnimation.runtime.raf,opacity:getComputedStyle(document.querySelector('#dragon-large canvas')).opacity}));assert.equal(reduced.raf,0);assert.equal(reduced.opacity,'0');
 await page.screenshot({path:`${out}/dragon-${platform}-${width}-reduced.png`});results.push({platform,width,reduced,errors});assert.equal(errors.length,0);
 }
 await page.close();
}}finally{await browser.close();await new Promise(r=>server.close(r));}
await fs.writeFile(out+'/'+mode+'-visual-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
