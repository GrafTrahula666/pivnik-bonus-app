import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {createRuntimeRelease} from '../spaceverse-runtime-release.js';
import {createSpaceverseRuntimeManifest,createSpaceverseRuntimeBundle} from '../spaceverse-runtime-manifest.js';
import {createSpaceverseTenantService} from '../spaceverse-tenant-service.js';

export const syntheticBotToken='synthetic-tenant-service-bot-token';
export const fixtureRoot=fileURLToPath(new URL('../',import.meta.url));
export async function prepareEmptyTenantDatabase(query){
 // Test-only schema. Never imported by a runtime or an Admin provisioning route.
 await query(`CREATE TABLE users(id BIGSERIAL PRIMARY KEY,telegram_id BIGINT UNIQUE,username TEXT,
  first_name TEXT NOT NULL,last_name TEXT,photo_url TEXT,role TEXT NOT NULL DEFAULT 'client',
  session_version BIGINT NOT NULL DEFAULT 1,deleted_at TIMESTAMPTZ,merged_into_user_id BIGINT);
  CREATE TABLE wallets(user_id BIGINT PRIMARY KEY REFERENCES users(id),balance BIGINT NOT NULL DEFAULT 0,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE user_identities(id BIGSERIAL PRIMARY KEY,user_id BIGINT REFERENCES users(id),provider TEXT,provider_user_id TEXT,
  provider_username TEXT,UNIQUE(provider,provider_user_id),UNIQUE(user_id,provider));`);
 for(const name of ['017_spaceverse_runtime_binding.sql','018_spaceverse_runtime_scope_binding.sql','019_spaceverse_customer_ownership.sql','020_spaceverse_customer_create_requests.sql','022_spaceverse_runtime_launch_authorizations.sql']){
  await query(await fs.readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
 }
}
export function telegramCredentials(id='101'){
 const params=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id:Number(id),first_name:'Тест'})});
 const sorted=[...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>`${key}=${value}`).join('\n');
 const secret=crypto.createHmac('sha256','WebAppData').update(syntheticBotToken).digest();
 params.set('hash',crypto.createHmac('sha256',secret).update(sorted).digest('hex'));
 return {platform:'telegram',initData:params.toString()};
}
export async function createTenantServiceFixture({companyId='700',venueId='701'}={}){
 const db=new PGlite();await prepareEmptyTenantDatabase(sql=>db.exec(sql));
 const manifest=createSpaceverseRuntimeManifest({draftId:crypto.randomUUID(),runtimeKey:'sv-'+crypto.randomBytes(16).toString('hex'),draftRevision:1,applicationRevision:1,scopeRevision:1,
  scope:{companyId,venueId},config:{displayName:'Synthetic tenant API',theme:'light',primaryColor:'#112233',secondaryColor:'#445566',shopEnabled:false,loyaltyEnabled:true}});
 await db.query(`INSERT INTO spaceverse_runtime_binding(singleton,runtime_key,manifest_sha256,manifest_revision,company_id,venue_id)
  VALUES(TRUE,$1,$2,1,$3,$4)`,[manifest.runtimeKey,manifest.manifestSha256,companyId,venueId]);
 const release=await createRuntimeRelease(fixtureRoot,'a'.repeat(40));
 const codeRelease={sourceSha:release.sourceSha,fingerprint:release.fingerprint,coverage:release.coverage,moduleCount:release.files.length};
 const imageRelease={imageId:'sha256:'+'1'.repeat(64),platform:'linux/amd64',contract:'tenant-runtime-v1'};
 const bundle=createSpaceverseRuntimeBundle(manifest,codeRelease,imageRelease),query=db.query.bind(db);
 const pool={query,connect:async()=>({query,release(){}})};
 const environment={SPACEVERSE_ENABLE_TENANT_SERVICE:'true',SPACEVERSE_RUNTIME_MODE:'tenant',SPACEVERSE_RUNTIME_APPROVED_IMAGE_ID:imageRelease.imageId,
  SPACEVERSE_RUNTIME_SESSION_SECRET:'synthetic-tenant-service-session-secret-only',SPACEVERSE_TELEGRAM_BOT_TOKEN:syntheticBotToken};
 async function grant(){
  const id=crypto.randomUUID(),key='svlaunch_'+crypto.randomBytes(32).toString('base64url');
  await query(`INSERT INTO spaceverse_runtime_launch_authorizations(id,runtime_key,manifest_sha256,bundle_sha256,image_id,token_hash,expires_at)
    VALUES($1::uuid,$2,$3,$4,$5,$6,NOW()+INTERVAL '5 minutes')`,[id,manifest.runtimeKey,manifest.manifestSha256,bundle.bundleSha256,imageRelease.imageId,crypto.createHash('sha256').update(key).digest('hex')]);
  environment.SPACEVERSE_RUNTIME_LAUNCH_AUTHORIZATION_ID=id;environment.SPACEVERSE_RUNTIME_LAUNCH_KEY=key;
  return {id,key};
 }
 await grant();let service;
 const options={environment,bundle,release,root:fixtureRoot,pool};
 return {db,query,manifest,bundle,release,environment,pool,options,grant,
  async start(overrides={}){
   service=await createSpaceverseTenantService({...options,...overrides});
   await new Promise(resolve=>service.server.listen(0,'127.0.0.1',resolve));
   const origin='http://127.0.0.1:'+service.server.address().port;
   return {service,request:async(path,{method='GET',body,token,headers={}}={})=>{
    const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json()};
   }};
  },async close(){await service?.close();await db.close();}};
}
