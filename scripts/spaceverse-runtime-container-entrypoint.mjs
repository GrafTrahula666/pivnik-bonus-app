// Immutable image gate. Neither npm prestart nor a legacy-mode fallback runs.
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {parseSpaceverseRuntimeBundle,runtimeEnvironmentFromSpaceverseBundle,guardSpaceverseRuntimeStartup} from '../spaceverse-runtime-manifest.js';
import {verifyRuntimeRelease} from '../spaceverse-runtime-release.js';

try{
 if(process.env.SPACEVERSE_RUNTIME_MODE!=='tenant')throw Object.assign(new Error(),{code:'SPACEVERSE_IMAGE_TENANT_MODE_REQUIRED'});
 const raw=process.env.SPACEVERSE_RUNTIME_BUNDLE_JSON;
 if(!raw)throw Object.assign(new Error(),{code:'SPACEVERSE_IMAGE_BUNDLE_REQUIRED'});
 const bundle=parseSpaceverseRuntimeBundle(raw),proof=bundle.artifact.codeRelease;
 if(!proof)throw Object.assign(new Error(),{code:'SPACEVERSE_IMAGE_RELEASE_REQUIRED'});
 const root=fileURLToPath(new URL('../',import.meta.url));
 const release=await fs.readFile(new URL('../spaceverse-runtime-release.json',import.meta.url),'utf8');
 await verifyRuntimeRelease(release,{root,expectedSourceSha:proof.sourceSha,expectedFingerprint:proof.fingerprint});
 const environment=runtimeEnvironmentFromSpaceverseBundle(bundle);
 if(process.env.SPACEVERSE_RUNTIME_MANIFEST_JSON&&process.env.SPACEVERSE_RUNTIME_MANIFEST_JSON!==environment.SPACEVERSE_RUNTIME_MANIFEST_JSON){
  throw Object.assign(new Error(),{code:'SPACEVERSE_IMAGE_MANIFEST_MISMATCH'});
 }
 // Startup remains closed by the existing policy. A subsequent approved
 // activation/runner must supply the verified DB and permit it explicitly.
 await guardSpaceverseRuntimeStartup({environment,query:async()=>{throw Object.assign(new Error(),{code:'SPACEVERSE_IMAGE_LAUNCH_NOT_AUTHORIZED'})}});
 throw Object.assign(new Error(),{code:'SPACEVERSE_IMAGE_LAUNCH_NOT_AUTHORIZED'});
}catch(error){
 const code=typeof error?.code==='string'&&/^(SPACEVERSE_|RUNTIME_RELEASE_)[A-Z0-9_]+$/.test(error.code)?error.code:'SPACEVERSE_IMAGE_START_REJECTED';
 process.stderr.write(code+'\n');process.exitCode=78;
}
