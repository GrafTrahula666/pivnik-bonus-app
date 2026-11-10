import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
const source = await fs.readFile(new URL('../app.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function creatorDragonPoint'), source.indexOf('function creatorDragonHtml')), context);
const point = context.creatorDragonPoint;
const texturePoint = context.creatorDragonTexturePoint;
const radial = (u, t) => { const p=point(-Math.PI/2+u*Math.PI,.42,t);return Math.hypot(p.x-.5,p.y-.5)-.42; };
const normalizedWave=(u,t)=>radial(u,t)/(.008+.024*u);
test('head leads neck along the circular flight at every sampled phase', () => {
  for(let t=0;t<18;t+=.15) {
    const head=point(-1.45,.42,t), neck=point(-1.15,.42,t), next=point(-1.45,.42,t+.001);
    assert((head.x-neck.x)*(next.x-head.x)+(head.y-neck.y)*(next.y-head.y)>0, `head trails at ${t}`);
  }
});
test('body wave crests propagate head to tail and adjacent points stay continuous', () => {
  for(let u=.1;u<.8;u+=.1)for(let t=0;t<3;t+=.2) {
    // ds = dt / (2 * 2.8), following the same crest toward the tail.
    assert(Math.abs(normalizedWave(u,t)-normalizedWave(u+.1,t+.56))<1e-10);
    const p=point(-Math.PI/2+u*Math.PI,.42,t),q=point(-Math.PI/2+(u+.0001)*Math.PI,.42,t);
    assert(Math.hypot(p.x-q.x,p.y-q.y)<.0003);
  }
  // At a single instant different body regions actually bend in opposite directions.
  assert(radial(.125,0)>0 && radial(.375,0)<0 && radial(.625,0)>0);
});

test('the actual source muzzle faces forward after the head-joint correction', () => {
  for(let t=0;t<18;t+=.15) {
    // Source-image muzzle and eye/horns anchor, normalized to the original PNG.
    const muzzle=texturePoint(.70,.15,t), eye=texturePoint(.63,.12,t), next=texturePoint(.70,.15,t+.001);
    assert((muzzle.x-eye.x)*(next.x-muzzle.x)+(muzzle.y-eye.y)*(next.y-muzzle.y)>0, `muzzle points backwards at ${t}`);
  }
});
