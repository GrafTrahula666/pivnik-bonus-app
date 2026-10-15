import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const RUNTIME_RELEASE_ENTRYPOINTS=Object.freeze(['server.js','universal-server.js']);
const extra=Object.freeze(['package.json','package-lock.json','spaceverse-runtime-manifest.js','routes/spaceverse-customer.js','routes/spaceverse-pos.js','scripts/spaceverse-runtime-container-entrypoint.mjs']);
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const fail=code=>Object.assign(new Error('Runtime release cannot be verified.'),{code});
const exact=(raw,keys)=>raw&&typeof raw==='object'&&!Array.isArray(raw)&&Object.keys(raw).length===keys.length&&Object.keys(raw).every(key=>keys.includes(key));
const sha=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const commit=value=>typeof value==='string'&&/^[0-9a-f]{40}$/.test(value);
const safeName=value=>typeof value==='string'&&value.length<=200&&/^[a-zA-Z0-9._/-]+$/.test(value)
 &&!path.posix.isAbsolute(value)&&value.split('/').every(part=>part!=='.'&&part!=='..'&&part&&!part.startsWith('.'));
function core(sourceSha,files){return {schemaVersion:1,artifact:'pivnik-bonus-app',contract:'tenant-runtime-v1',coverage:'node_literal_import_closure',sourceSha,entrypoints:[...RUNTIME_RELEASE_ENTRYPOINTS],files};}
function imports(text){
 const result=new Set();
 // Covers literal static, re-export and dynamic Node imports. No code is executed.
 for(const match of text.matchAll(/\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g)){
  const value=match[1]??match[2]??match[3];if(value?.startsWith('.'))result.add(value);
 }
 return [...result];
}
async function readModule(root,name){
 if(!safeName(name)||!['.js','.mjs','.json'].includes(path.extname(name)))throw fail('RUNTIME_RELEASE_INVALID')
 const absolute=path.resolve(root,name),realRoot=await fs.realpath(root);
 const stat=await fs.lstat(absolute).catch(()=>{throw fail('RUNTIME_RELEASE_UNAVAILABLE')});
 const real=await fs.realpath(absolute);
 if(!stat.isFile()||stat.isSymbolicLink()||!real.startsWith(realRoot+path.sep)||stat.size>4*1024*1024)throw fail('RUNTIME_RELEASE_INVALID');
 const bytes=await fs.readFile(absolute);
 return {bytes,record:{path:name,size:bytes.length,sha256:hash(bytes)}};
}
async function closure(root){
 const pending=[...RUNTIME_RELEASE_ENTRYPOINTS,...extra],seen=new Map();let size=0;
 while(pending.length){
  const name=pending.pop();if(seen.has(name))continue;
  if(seen.size>=200)throw fail('RUNTIME_RELEASE_INVALID');
  const {bytes,record}=await readModule(root,name);size+=bytes.length;
  if(size>16*1024*1024)throw fail('RUNTIME_RELEASE_INVALID');
  seen.set(name,record);
  if(['.js','.mjs'].includes(path.extname(name))){
   for(const dependency of imports(bytes.toString('utf8'))){
    const next=path.posix.normalize(path.posix.join(path.posix.dirname(name),dependency));
    if(!safeName(next))throw fail('RUNTIME_RELEASE_INVALID');pending.push(next);
   }
  }
 }
 return [...seen.values()].sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
export async function createRuntimeRelease(root,sourceSha){
 if(!commit(sourceSha))throw fail('RUNTIME_RELEASE_INVALID');
 const value=core(sourceSha,await closure(root));
 return {...value,fingerprint:hash(JSON.stringify(value))};
}
export function parseRuntimeRelease(raw){
 if(typeof raw==='string'){
  if(Buffer.byteLength(raw)>80_000)throw fail('RUNTIME_RELEASE_INVALID');
  try{raw=JSON.parse(raw)}catch{throw fail('RUNTIME_RELEASE_INVALID')}
 }
 if(!exact(raw,['schemaVersion','artifact','contract','coverage','sourceSha','entrypoints','files','fingerprint'])
  ||raw.schemaVersion!==1||raw.artifact!=='pivnik-bonus-app'||raw.contract!=='tenant-runtime-v1'
  ||raw.coverage!=='node_literal_import_closure'||!commit(raw.sourceSha)||!sha(raw.fingerprint)
  ||!Array.isArray(raw.entrypoints)||JSON.stringify(raw.entrypoints)!==JSON.stringify(RUNTIME_RELEASE_ENTRYPOINTS)
  ||!Array.isArray(raw.files)||raw.files.length<extra.length||raw.files.length>200)throw fail('RUNTIME_RELEASE_INVALID');
 let previous='';
 for(const file of raw.files){
  if(!exact(file,['path','size','sha256'])||!safeName(file.path)||!sha(file.sha256)
   ||!Number.isSafeInteger(file.size)||file.size<0||file.size>4*1024*1024
   ||(previous&&previous.localeCompare(file.path,'en')>=0))throw fail('RUNTIME_RELEASE_INVALID');
  previous=file.path;
 }
 for(const required of [...RUNTIME_RELEASE_ENTRYPOINTS,...extra])if(!raw.files.some(file=>file.path===required))throw fail('RUNTIME_RELEASE_INVALID');
 const value=core(raw.sourceSha,raw.files.map(file=>({path:file.path,size:file.size,sha256:file.sha256})));
 if(hash(JSON.stringify(value))!==raw.fingerprint)throw fail('RUNTIME_RELEASE_INVALID');
 return {...value,fingerprint:raw.fingerprint};
}
export async function verifyRuntimeRelease(raw,{root,expectedSourceSha,expectedFingerprint}){
 if(!commit(expectedSourceSha)||!sha(expectedFingerprint))throw fail('RUNTIME_RELEASE_NOT_REGISTERED');
 const release=parseRuntimeRelease(raw);
 if(release.sourceSha!==expectedSourceSha||release.fingerprint!==expectedFingerprint)throw fail('RUNTIME_RELEASE_MISMATCH');
 const actual=await createRuntimeRelease(root,expectedSourceSha);
 if(actual.fingerprint!==release.fingerprint)throw fail('RUNTIME_RELEASE_MISMATCH');
 return Object.freeze({sourceSha:release.sourceSha,fingerprint:release.fingerprint,coverage:release.coverage,moduleCount:release.files.length});
}
