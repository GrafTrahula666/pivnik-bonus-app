import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {verifyRuntimeRelease} from '../spaceverse-runtime-release.js';
import {verifyRuntimeImageInspection} from '../spaceverse-runtime-image.js';
import {createSpaceverseRuntimeManifest,createSpaceverseRuntimeBundle} from '../spaceverse-runtime-manifest.js';
const imageId='sha256:'+'1'.repeat(64),codeRelease={sourceSha:'a'.repeat(40),fingerprint:'b'.repeat(64),coverage:'node_literal_import_closure',moduleCount:45};
function inspection(){return {Id:imageId,Os:'linux',Architecture:'amd64',Config:{User:'node',WorkingDir:'/app',Entrypoint:null,Cmd:['node','scripts/spaceverse-runtime-container-entrypoint.mjs'],Env:['NODE_ENV=production','SPACEVERSE_RUNTIME_MODE=tenant'],Labels:{'org.opencontainers.image.source':'https://github.com/GrafTrahula666/pivnik-bonus-app','org.opencontainers.image.revision':codeRelease.sourceSha,'spaceverse.runtime.contract':'tenant-runtime-v1','spaceverse.runtime.code-fingerprint':codeRelease.fingerprint}}};}
test('immutable ID and source/contract/config are verified while launch remains not_provisioned',()=>{
 assert.deepEqual(verifyRuntimeImageInspection([inspection()],{expectedImageId:imageId,codeRelease}),{imageId,sourceSha:codeRelease.sourceSha,fingerprint:codeRelease.fingerprint,platform:'linux/amd64',contract:'tenant-runtime-v1',runtimeStatus:'not_provisioned',published:false});
 assert.throws(()=>verifyRuntimeImageInspection(inspection(),{expectedImageId:'spaceverse:latest',codeRelease}),{code:'RUNTIME_IMAGE_NOT_REGISTERED'});
 assert.throws(()=>verifyRuntimeImageInspection({...inspection(),Id:'sha256:'+'2'.repeat(64)},{expectedImageId:imageId,codeRelease}),{code:'RUNTIME_IMAGE_MISMATCH'});
});
test('build context verifies copied release and excludes credentials, admin files and host dependencies; retry never overwrites',async()=>{
 const parent=await fs.mkdtemp(path.join(os.tmpdir(),'spaceverse-image-context-')),directory=path.join(parent,'context');
 const script=fileURLToPath(new URL('../scripts/prepare-spaceverse-runtime-image.mjs',import.meta.url));
 const run=promisify(execFile),result=await run(process.execPath,[script,'--output',directory]);
 const summary=JSON.parse(result.stdout),release=JSON.parse(await fs.readFile(path.join(directory,'spaceverse-runtime-release.json'),'utf8'));
 const proof=await verifyRuntimeRelease(release,{root:directory,expectedSourceSha:summary.sourceSha,expectedFingerprint:summary.fingerprint});
 assert.equal(proof.moduleCount,summary.moduleCount);
 assert.equal((await fs.stat(directory)).mode&0o777,0o700);
 assert.equal((await fs.stat(path.join(directory,'scripts'))).mode&0o777,0o755);
 for(const file of ['scripts/spaceverse-runtime-container-entrypoint.mjs','spaceverse-runtime-release.json'])assert.equal((await fs.stat(path.join(directory,file))).mode&0o777,0o644);
 for(const excluded of ['.git','.env','.npmrc','.cloud-setup','admin-platform','node_modules','test'])await assert.rejects(fs.stat(path.join(directory,excluded)),{code:'ENOENT'});
 assert.match(await fs.readFile(path.join(directory,'.dockerignore'),'utf8'),/^node_modules\n/);
 await assert.rejects(run(process.execPath,[script,'--output',directory]),error=>error.code===1&&error.stderr==='SPACEVERSE_IMAGE_CONTEXT_EXISTS\n');
 assert.equal(await fs.readFile(path.join(directory,'spaceverse-runtime-release.json'),'utf8'),JSON.stringify(release,null,2)+'\n');
 const manifest=createSpaceverseRuntimeManifest({draftId:'12345678-1234-4123-8123-123456789abc',runtimeKey:'sv-'+'4'.repeat(32),draftRevision:1,applicationRevision:1,scopeRevision:1,
  scope:{companyId:'10',venueId:'11'},config:{displayName:'No legacy fallback',theme:'light',primaryColor:'#112233',secondaryColor:'#445566',shopEnabled:false,loyaltyEnabled:true}});
 const bundle=createSpaceverseRuntimeBundle(manifest,proof,{imageId,platform:'linux/amd64',contract:'tenant-runtime-v1'});
 await assert.rejects(run(process.execPath,[path.join(directory,'scripts/spaceverse-runtime-container-entrypoint.mjs')],{env:{PATH:process.env.PATH,
  SPACEVERSE_RUNTIME_MODE:'tenant',SPACEVERSE_ENABLE_TENANT_SERVICE:'true',SPACEVERSE_RUNTIME_BUNDLE_JSON:JSON.stringify(bundle),
  DATABASE_URL:'postgres://synthetic@127.0.0.1:1/not-used'}}),error=>error.code===78&&error.stderr==='SPACEVERSE_LAUNCH_CONFIGURATION_REQUIRED\n'&&error.stdout==='');
});
test('root/legacy/prestart, wrong revision, another platform and baked secrets cannot pass image contract',()=>{
 for(const patch of [{User:'root'},{Cmd:['npm','start']},{Entrypoint:['sh']},{Env:['NODE_ENV=production','SPACEVERSE_RUNTIME_MODE=legacy-pivnik']},{Env:['NODE_ENV=production','SPACEVERSE_RUNTIME_MODE=tenant','SESSION_SECRET=synthetic-only']},{Env:['NODE_ENV=production','SPACEVERSE_RUNTIME_MODE=tenant','SPACEVERSE_RUNTIME_MODE=legacy-pivnik']},{Env:['NODE_ENV=production','SPACEVERSE_RUNTIME_MODE=tenant','ADMIN_CSRF_KEY=synthetic-only']},{Labels:{...inspection().Config.Labels,'org.opencontainers.image.revision':'c'.repeat(40)}}]){
  assert.throws(()=>verifyRuntimeImageInspection({...inspection(),Config:{...inspection().Config,...patch}},{expectedImageId:imageId,codeRelease}),{code:'RUNTIME_IMAGE_CONTRACT_INVALID'});
 }
 assert.throws(()=>verifyRuntimeImageInspection({...inspection(),Architecture:'arm64'},{expectedImageId:imageId,codeRelease}),{code:'RUNTIME_IMAGE_MISMATCH'});
});
test('container entrypoint rejects legacy/missing bundle before any DB or legacy service is loaded',async()=>{
 const script=fileURLToPath(new URL('../scripts/spaceverse-runtime-container-entrypoint.mjs',import.meta.url));
 for(const [mode,expected] of [['legacy-pivnik','SPACEVERSE_IMAGE_TENANT_MODE_REQUIRED'],['tenant','SPACEVERSE_IMAGE_BUNDLE_REQUIRED']]){
  const child=spawn(process.execPath,[script],{env:{PATH:process.env.PATH,SPACEVERSE_RUNTIME_MODE:mode},stdio:['ignore','pipe','pipe']});
  let stderr='',stdout='';child.stderr.on('data',value=>{stderr+=value});child.stdout.on('data',value=>{stdout+=value});
  const result=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve)});
  assert.equal(result,78);assert.equal(stderr.trim(),expected);assert.equal(stdout,'');
 }
});
