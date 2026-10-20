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
 if(process.env.SPACEVERSE_ENABLE_TENANT_SERVICE==='true'){
  // Dedicated configuration only: never fall back to the PIVNIK database or
  // secrets. This API cannot start either of the legacy entrypoints.
  const databaseUrl=process.env.SPACEVERSE_RUNTIME_DATABASE_URL??'',port=Number(process.env.PORT??3000);
  if(!databaseUrl||!Number.isSafeInteger(port)||port<1||port>65535)throw Object.assign(new Error(),{code:'SPACEVERSE_LAUNCH_CONFIGURATION_REQUIRED'});
  const {default:pg}=await import('pg');
  const {createSpaceverseTenantService}=await import('../spaceverse-tenant-service.js');
  const pool=new pg.Pool({connectionString:databaseUrl,max:4,connectionTimeoutMillis:5000,query_timeout:5000,statement_timeout:5000,idleTimeoutMillis:30_000,application_name:'spaceverse-tenant-api'});
  try{
   const service=await createSpaceverseTenantService({environment:process.env,bundle,release,root,pool});
   await new Promise((resolve,reject)=>{service.server.once('error',reject);service.server.listen(port,process.env.SPACEVERSE_RUNTIME_BIND_HOST??'0.0.0.0',resolve)}).catch(async error=>{
    await service.close();throw Object.assign(new Error(),{code:error.code==='EADDRINUSE'?'SPACEVERSE_RUNTIME_PORT_IN_USE':'SPACEVERSE_RUNTIME_LISTEN_FAILED'});
   });
   service.server.once('close',()=>{void pool.end().catch(()=>undefined)});
   for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{void service.close()});
  }catch(error){await pool.end().catch(()=>undefined);throw error;}
 }else{
  await guardSpaceverseRuntimeStartup({environment,query:async()=>{throw Object.assign(new Error(),{code:'SPACEVERSE_IMAGE_LAUNCH_NOT_AUTHORIZED'})}});
  throw Object.assign(new Error(),{code:'SPACEVERSE_IMAGE_LAUNCH_NOT_AUTHORIZED'});
 }
}catch(error){
 const code=typeof error?.code==='string'&&/^(SPACEVERSE_|RUNTIME_RELEASE_)[A-Z0-9_]+$/.test(error.code)?error.code:'SPACEVERSE_IMAGE_START_REJECTED';
 process.stderr.write(code+'\n');process.exitCode=78;
}
