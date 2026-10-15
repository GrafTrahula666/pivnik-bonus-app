import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRuntimeRelease,parseRuntimeRelease,verifyRuntimeRelease} from '../spaceverse-runtime-release.js';
import {createSpaceverseRuntimeManifest,createSpaceverseRuntimeBundle,parseSpaceverseRuntimeBundle,runtimeEnvironmentFromSpaceverseBundle} from '../spaceverse-runtime-manifest.js';
const sourceSha='a'.repeat(40);
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'spaceverse-release-'));
 await fs.mkdir(path.join(root,'routes'));
 for(const file of ['server.js','universal-server.js','spaceverse-runtime-manifest.js','routes/spaceverse-customer.js','routes/spaceverse-pos.js'])await fs.writeFile(path.join(root,file),"import './"+(file.startsWith('routes/')?'../':'')+"dependency.js';\n");
 await fs.writeFile(path.join(root,'dependency.js'),'export const safe=true;\n');
 await fs.writeFile(path.join(root,'package.json'),JSON.stringify({type:'module'}));await fs.writeFile(path.join(root,'package-lock.json'),'{}');
 return {root,release:await createRuntimeRelease(root,sourceSha)};
}
test('release verifies actual Node dependencies and requires operator-approved SHA/fingerprint without executing code',async()=>{
 const f=await fixture(),expected={root:f.root,expectedSourceSha:sourceSha,expectedFingerprint:f.release.fingerprint};
 const proof=await verifyRuntimeRelease(JSON.stringify(f.release),expected);assert.equal(proof.moduleCount,8);
 await assert.rejects(verifyRuntimeRelease(f.release,{...expected,expectedFingerprint:''}),{code:'RUNTIME_RELEASE_NOT_REGISTERED'});
 await assert.rejects(verifyRuntimeRelease(f.release,{...expected,expectedSourceSha:'b'.repeat(40)}),{code:'RUNTIME_RELEASE_MISMATCH'});
 await fs.writeFile(path.join(f.root,'dependency.js'),'throw new Error("Never executed");\n');
 await assert.rejects(verifyRuntimeRelease(f.release,expected),{code:'RUNTIME_RELEASE_MISMATCH'});
});
test('adding a literal dependency invalidates the approved closure; traversal and symlink targets are rejected',async()=>{
 const f=await fixture(),expected={root:f.root,expectedSourceSha:sourceSha,expectedFingerprint:f.release.fingerprint};
 await fs.writeFile(path.join(f.root,'new-module.js'),'export const added=true;');
 await fs.appendFile(path.join(f.root,'dependency.js'),"\nexport {added} from './new-module.js';\n");
 await assert.rejects(verifyRuntimeRelease(f.release,expected),{code:'RUNTIME_RELEASE_MISMATCH'});
 await fs.writeFile(path.join(f.root,'dependency.js'),"import '../outside.js';\n");
 await assert.rejects(createRuntimeRelease(f.root,sourceSha),{code:'RUNTIME_RELEASE_INVALID'});
 const other=await fixture();await fs.symlink(path.join(other.root,'package.json'),path.join(f.root,'linked.js'));
 await fs.writeFile(path.join(f.root,'dependency.js'),"import './linked.js';\n");
 await assert.rejects(createRuntimeRelease(f.root,sourceSha),{code:'RUNTIME_RELEASE_INVALID'});
});
test('release record rejects duplicate/omitted paths and arbitrary fields even if its digest is recomputed',async()=>{
 const f=await fixture();
 const rehash=value=>{const {fingerprint,...body}=value;return {...body,fingerprint:crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex')};};
 assert.throws(()=>parseRuntimeRelease(rehash({...f.release,files:[...f.release.files,f.release.files[0]]})),{code:'RUNTIME_RELEASE_INVALID'});
 assert.throws(()=>parseRuntimeRelease(rehash({...f.release,files:f.release.files.filter(file=>file.path!=='server.js')})),{code:'RUNTIME_RELEASE_INVALID'});
 assert.throws(()=>parseRuntimeRelease({...f.release,credential:'never allowed'}),{code:'RUNTIME_RELEASE_INVALID'});
});
test('bundle v2 pins the code proof and preserves not_provisioned; v1 remains readable and tampering cannot alter tenant/launch policy',async()=>{
 const f=await fixture(),proof=await verifyRuntimeRelease(f.release,{root:f.root,expectedSourceSha:sourceSha,expectedFingerprint:f.release.fingerprint});
 const manifest=createSpaceverseRuntimeManifest({draftId:crypto.randomUUID(),runtimeKey:'sv-'+'1'.repeat(32),draftRevision:1,applicationRevision:1,scopeRevision:1,scope:{companyId:'10',venueId:'11'},config:{displayName:'Release fixture',theme:'light',primaryColor:'#112233',secondaryColor:'#445566',shopEnabled:false,loyaltyEnabled:true}});
 const old=createSpaceverseRuntimeBundle(manifest);assert.equal(parseSpaceverseRuntimeBundle(old).schemaVersion,1);
 const bundle=createSpaceverseRuntimeBundle(manifest,proof);assert.equal(parseSpaceverseRuntimeBundle(JSON.stringify(bundle)).schemaVersion,2);
 assert.equal(bundle.artifact.codeRelease.sourceSha,sourceSha);assert.deepEqual(bundle.release,{runtimeStatus:'not_provisioned',published:false,startAllowed:false});
 assert.deepEqual(runtimeEnvironmentFromSpaceverseBundle(bundle),runtimeEnvironmentFromSpaceverseBundle(old));
 assert.throws(()=>parseSpaceverseRuntimeBundle({...bundle,artifact:{...bundle.artifact,codeRelease:{...proof,fingerprint:'f'.repeat(64)}}}),{code:'SPACEVERSE_RUNTIME_BUNDLE_DIGEST_MISMATCH'});
 assert.throws(()=>parseSpaceverseRuntimeBundle({...bundle,release:{...bundle.release,startAllowed:true}}),{code:'SPACEVERSE_RUNTIME_BUNDLE_INVALID'});
});
