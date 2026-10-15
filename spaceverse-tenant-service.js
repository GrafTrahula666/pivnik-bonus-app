import crypto from 'node:crypto';
import http from 'node:http';
import {parseSpaceverseRuntimeBundle,runtimeEnvironmentFromSpaceverseBundle,resolveSpaceverseRuntime} from './spaceverse-runtime-manifest.js';
import {verifyRuntimeRelease} from './spaceverse-runtime-release.js';
import {RUNTIME_READINESS_PROTOCOL,RUNTIME_LAUNCH_KEY_PATTERN,signRuntimeReadiness} from './spaceverse-runtime-readiness.js';
import {createSpaceverseCustomerHttp} from './routes/spaceverse-customer.js';
import {createSpaceversePosHttp} from './routes/spaceverse-pos.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fail=code=>Object.assign(new Error('Tenant API cannot be started.'),{code});
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function send(res,status,payload){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(payload));}

// The existing binding remains the sole authority for company/venue identity.
export const RUNTIME_LAUNCH_AUTHORIZATION_SQL=`SELECT a.expires_at::text AS expires_at
FROM spaceverse_runtime_binding b JOIN spaceverse_runtime_launch_authorizations a ON a.runtime_key=b.runtime_key
WHERE b.singleton=TRUE AND b.runtime_key=$1 AND b.manifest_sha256=$2 AND b.manifest_revision=$3
 AND b.company_id=$4 AND b.venue_id=$5 AND b.isolation_policy='dedicated_database' AND b.status='prepared'
 AND a.id=$6::uuid AND a.manifest_sha256=b.manifest_sha256 AND a.bundle_sha256=$7 AND a.image_id=$8
 AND a.token_hash=$9 AND a.state='authorized' AND a.revoked_at IS NULL AND a.authorized_at<=NOW() AND a.expires_at>NOW()`;

/** A narrow tenant API, never a permission to boot either legacy entrypoint.
 * It does not provision schema/devices or publish a frontend. */
export async function createSpaceverseTenantService({environment={},bundle:rawBundle,release,root,pool}){
 if(environment.SPACEVERSE_ENABLE_TENANT_SERVICE!=='true')throw fail('SPACEVERSE_TENANT_SERVICE_DISABLED');
 if(environment.SPACEVERSE_RUNTIME_MODE!=='tenant')throw fail('SPACEVERSE_IMAGE_TENANT_MODE_REQUIRED');
 const bundle=parseSpaceverseRuntimeBundle(rawBundle);
 if(bundle.schemaVersion!==3)throw fail('SPACEVERSE_IMAGE_APPROVAL_REQUIRED');
 if(environment.SPACEVERSE_RUNTIME_APPROVED_IMAGE_ID!==bundle.artifact.imageRelease.imageId)throw fail('SPACEVERSE_IMAGE_APPROVAL_MISMATCH');
 const runtimeEnvironment=runtimeEnvironmentFromSpaceverseBundle(bundle);
 if(environment.SPACEVERSE_RUNTIME_MANIFEST_JSON&&environment.SPACEVERSE_RUNTIME_MANIFEST_JSON!==runtimeEnvironment.SPACEVERSE_RUNTIME_MANIFEST_JSON)throw fail('SPACEVERSE_IMAGE_MANIFEST_MISMATCH');
 const key=environment.SPACEVERSE_RUNTIME_LAUNCH_KEY??'',authorizationId=environment.SPACEVERSE_RUNTIME_LAUNCH_AUTHORIZATION_ID??'';
 const sessionSecret=environment.SPACEVERSE_RUNTIME_SESSION_SECRET??'';
 if(!uuid.test(authorizationId)||!RUNTIME_LAUNCH_KEY_PATTERN.test(key)||sessionSecret.length<32||!sessionSecret.trim())throw fail('SPACEVERSE_LAUNCH_CREDENTIALS_REQUIRED');
 await verifyRuntimeRelease(release,{root,expectedSourceSha:bundle.artifact.codeRelease.sourceSha,expectedFingerprint:bundle.artifact.codeRelease.fingerprint});
 const runtime=await resolveSpaceverseRuntime({environment:runtimeEnvironment,query:pool.query.bind(pool)}),m=runtime.manifest;
 const params=[m.runtimeKey,m.manifestSha256,m.source.applicationRevision,m.scope.companyId,m.scope.venueId,authorizationId,bundle.bundleSha256,bundle.artifact.imageRelease.imageId,hash(key)];
 let lease,locked=false,healthy=true,server,cleanup;
 const releaseLease=()=>cleanup??=(async()=>{
  healthy=false;lease?.removeListener?.('error',lost);lease?.removeListener?.('end',lost);
  if(locked)await lease.query('SELECT pg_advisory_unlock(44216,hashtext($1))',[m.runtimeKey]).catch(()=>undefined);
  lease?.release();
 })();
 const lost=()=>{healthy=false;server?.closeIdleConnections();server?.close(()=>undefined);};
 const check=async(query=pool.query.bind(pool))=>{
  if(!healthy)throw fail('SPACEVERSE_RUNTIME_LEASE_LOST');
  try{
   const found=await query(RUNTIME_LAUNCH_AUTHORIZATION_SQL,params);
   if(found.rows.length!==1){lost();throw fail('SPACEVERSE_LAUNCH_AUTHORIZATION_REJECTED');}
   return new Date(found.rows[0].expires_at).toISOString();
  }catch(error){if(error.code?.startsWith('SPACEVERSE_'))throw error;throw fail(error.code==='42P01'?'SPACEVERSE_LAUNCH_SCHEMA_REQUIRED':'SPACEVERSE_LAUNCH_DATABASE_UNAVAILABLE');}
 };
 try{
  lease=await pool.connect();lease.on?.('error',lost);lease.on?.('end',lost);
  locked=(await lease.query('SELECT pg_try_advisory_lock(44216,hashtext($1)) AS acquired',[m.runtimeKey])).rows[0]?.acquired===true;
  if(!locked)throw fail('SPACEVERSE_RUNTIME_ALREADY_SERVING');
  await check(lease.query.bind(lease));
  const customer=createSpaceverseCustomerHttp({runtime,pool,sessionSecret,telegramBotToken:environment.SPACEVERSE_TELEGRAM_BOT_TOKEN??'',vkAppId:environment.SPACEVERSE_VK_APP_ID??'',vkAppSecret:environment.SPACEVERSE_VK_APP_SECRET??''});
  const pos=createSpaceversePosHttp({runtime,pool}),attempts=new Map();
  server=http.createServer((req,res)=>{void (async()=>{
   try{
    const url=new URL(req.url||'/','http://localhost');
    if(url.pathname==='/internal/spaceverse/runtime/readiness'){
     const address=req.socket.remoteAddress??'unknown',now=Date.now(),previous=attempts.get(address);
     if(previous?.until>now&&previous.count>=60){send(res,429,{code:'SPACEVERSE_READINESS_RATE_LIMIT'});return;}
     if(attempts.size>=1000)for(const [id,row] of attempts)if(row.until<=now)attempts.delete(id);
     if(!previous&&attempts.size>=1000){send(res,429,{code:'SPACEVERSE_READINESS_RATE_LIMIT'});return;}
     if(!previous||previous.until<=now)attempts.set(address,{until:now+60_000,count:1});else previous.count++;
     const supplied=req.headers['x-spaceverse-launch-key'];
     if(typeof supplied!=='string'||!RUNTIME_LAUNCH_KEY_PATTERN.test(supplied)||!crypto.timingSafeEqual(Buffer.from(hash(supplied),'hex'),Buffer.from(hash(key),'hex'))){send(res,401,{code:'SPACEVERSE_READINESS_KEY_REQUIRED'});return;}
     if(req.method!=='GET'||url.searchParams.getAll('challenge').length!==1||[...url.searchParams.keys()].some(name=>name!=='challenge')||!uuid.test(url.searchParams.get('challenge')??'')){send(res,400,{code:'SPACEVERSE_READINESS_REQUEST_INVALID'});return;}
     const expiresAt=await check();
     send(res,200,signRuntimeReadiness({protocol:RUNTIME_READINESS_PROTOCOL,challenge:url.searchParams.get('challenge'),observedAt:new Date().toISOString(),
      runtime:{key:m.runtimeKey,checksum:m.manifestSha256,companyId:m.scope.companyId,venueId:m.scope.venueId,applicationRevision:m.source.applicationRevision},
      artifact:{imageId:bundle.artifact.imageRelease.imageId,bundleSha256:bundle.bundleSha256,sourceSha:bundle.artifact.codeRelease.sourceSha,fingerprint:bundle.artifact.codeRelease.fingerprint},
      authorization:{id:authorizationId,expiresAt},service:{state:'serving',scope:'tenant-api-only',published:false}},key));return;
    }
    await check();
    if(url.pathname==='/health'&&req.method==='GET'&&!url.search){send(res,200,{service:'spaceverse-tenant-api',status:'serving',runtimeStatus:'not_provisioned',published:false});return;}
    if(await pos(req,res)||await customer(req,res))return;
    send(res,404,{code:'SPACEVERSE_RUNTIME_ROUTE_NOT_PROVISIONED'});
   }catch(error){if(!res.headersSent)send(res,503,{code:error.code?.startsWith('SPACEVERSE_')?error.code:'SPACEVERSE_TENANT_SERVICE_UNAVAILABLE',error:'Приложение временно недоступно. Проверьте разрешение запуска и связь с выделенной базой.'});else res.destroy();}
  })();});
  server.requestTimeout=10_000;server.headersTimeout=10_000;server.keepAliveTimeout=5000;server.maxRequestsPerSocket=100;
  server.once('close',()=>{void releaseLease()});
  return Object.freeze({server,runtime,async close(){if(server.listening)await new Promise(resolve=>server.close(resolve));await releaseLease();}});
 }catch(error){await releaseLease();throw error.code?.startsWith('SPACEVERSE_')?error:fail('SPACEVERSE_LAUNCH_DATABASE_UNAVAILABLE');}
}
