import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source=await fs.readFile(path.join(root,'app.js'),'utf8');
const renderer=source.slice(source.indexOf('function avatarAssetUrl'),source.indexOf('function profileDraftFromCurrent'));
const index=(await fs.readFile(path.join(root,'index.html'),'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const server=http.createServer(async(req,res)=>{
 const file=req.url==='/'?'index.html':new URL(req.url,'http://localhost').pathname.slice(1);
 try {
  if(file.includes('..'))throw Error();
  const data=file==='index.html'?index:await fs.readFile(path.join(root,file));
  res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':file.endsWith('.png')?'image/png':file.endsWith('.webp')?'image/webp':'text/javascript');res.end(data);
 }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--single-process','--no-zygote','--disable-gpu','--disable-software-rasterizer','--use-gl=disabled']} : {})});
try {
 const page=await browser.newPage({viewport:{width:430,height:932}});
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.addScriptTag({content:`const escapeHtml=(v)=>String(v).replace(/[&<>"']/g,'');\n${renderer}`});
 await page.evaluate(()=>{
  document.querySelector('#bootScreen')?.remove();
  const hero=document.querySelector('.spaceverse-home-hero');
  const parent=hero.parentElement;
  parent.replaceChildren(hero);
  document.querySelectorAll('body > :not(#appShell)').forEach(e=>e.remove());
  document.querySelector('header')?.remove();
  document.querySelector('#appShell').classList.remove('hidden');
  document.querySelector('#clientName').textContent='Кирилл';
  document.querySelector('#clientBalance').textContent='∞';
  document.querySelector('#balanceLabel').textContent='Ваш баланс';
  document.querySelector('#statusName').textContent='Создатель';
  renderAvatarInto(document.querySelector('#profileAvatar'),{profileFrame:'gold-bars',avatarSource:'preset_male'});
  const comparison=document.createElement('div');
  comparison.style.cssText='display:flex;justify-content:space-around;gap:50px;padding:50px 30px 30px;color:#76551c;';
  comparison.innerHTML='<div style="text-align:center"><div id="largeGold" class="profile-avatar has-gold-bars-frame" style="position:relative;width:120px;height:120px;margin:30px 0 40px"></div>Кирилл</div><div style="text-align:center"><div id="largeMoney" class="profile-avatar has-money-frame" style="position:relative;width:120px;height:120px;margin:30px 0 40px"></div>@SevTrout</div>';
  parent.append(comparison);
  renderAvatarInto(document.querySelector('#largeGold'),{profileFrame:'gold-bars',avatarSource:'preset_male'});
  renderAvatarInto(document.querySelector('#largeMoney'),{profileFrame:'money',avatarSource:'preset_male'});
 });
 await page.waitForFunction(()=>Array.from(document.images).every(img=>img.complete));
 const positions=async(time)=>page.evaluate((time)=>{
  document.getAnimations().forEach(a=>{a.pause();a.currentTime=time;});
  const avatar=document.querySelector('#profileAvatar');
  const base=avatar.querySelector('.gold-orbital-base');
  const bar=avatar.querySelector('.gold-ingot');
  const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
  return {base:rect(base),bar:rect(bar),baseAnimation:getComputedStyle(base).animationName,ring:getComputedStyle(avatar.querySelector('.avatar-render-inner'),'::before').content,angle:getComputedStyle(avatar.querySelector('.gold-bars-orbit > i:nth-child(2)')).transform,avatar:rect(avatar)};
 },time);
 const a=await positions(0);const b=await positions(2000);
 const relative=(v)=>({...v.base,x:v.base.x-v.avatar.x,y:v.base.y-v.avatar.y});assert.deepEqual(relative(a),relative(b));assert.equal(b.baseAnimation,'none');assert.equal(b.ring,'none');assert.notDeepEqual(a.bar,b.bar);assert.notEqual(b.angle,'matrix(0.78, 0, 0, 0.78, 0, 0)');
 for(const width of [375,430]){
  await page.setViewportSize({width,height:800});
  await positions(1500);
  const clear = await page.evaluate(()=>{const base=document.querySelector('#profileAvatar .gold-orbital-base').getBoundingClientRect();const balance=document.querySelector('.spaceverse-home-hero .balance').getBoundingClientRect();return base.right < balance.left;});
  assert.ok(clear, `gold frame overlaps balance at width ${width}`);
  await page.screenshot({path:`${root}/ops/personal-frames-preview-${width}.png`,fullPage:true});
 }
 await page.emulateMedia({reducedMotion:'reduce'});
 assert.equal(await page.locator('#profileAvatar .gold-bars-orbit').evaluate(e=>getComputedStyle(e).animationName),'none');
 console.log(JSON.stringify({ok:true,baseStatic:true,barsMove:true,reducedMotion:true,before:a,after:b}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
