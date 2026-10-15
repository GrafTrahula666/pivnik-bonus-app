import crypto from 'node:crypto';
import {parseSpaceverseRuntimeBundle} from './spaceverse-runtime-manifest.js';

export const RUNTIME_READINESS_PROTOCOL='spaceverse-runtime-readiness-v1';
export const RUNTIME_LAUNCH_KEY_PATTERN=/^svlaunch_[A-Za-z0-9_-]{43}$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hex=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const fail=()=>Object.assign(new Error('Runtime readiness cannot be verified.'),{code:'SPACEVERSE_RUNTIME_READINESS_REJECTED'});
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
function body(raw){
 if(!exact(raw,['protocol','challenge','observedAt','runtime','artifact','authorization','service'])
  ||raw.protocol!==RUNTIME_READINESS_PROTOCOL||!uuid.test(raw.challenge)||!iso(raw.observedAt)
  ||!exact(raw.runtime,['key','checksum','companyId','venueId','applicationRevision'])
  ||!exact(raw.artifact,['imageId','bundleSha256','sourceSha','fingerprint'])
  ||!exact(raw.authorization,['id','expiresAt'])||!uuid.test(raw.authorization.id)||!iso(raw.authorization.expiresAt)
  ||!exact(raw.service,['state','scope','published'])||raw.service.state!=='serving'||raw.service.scope!=='tenant-api-only'||raw.service.published!==false)throw fail();
 const {runtime:r,artifact:a,authorization:p}=raw;
 if(typeof r.key!=='string'||!/^sv-[0-9a-f]{32}$/.test(r.key)||!hex(r.checksum)
  ||typeof r.companyId!=='string'||!/^[1-9]\d{0,18}$/.test(r.companyId)||typeof r.venueId!=='string'||!/^[1-9]\d{0,18}$/.test(r.venueId)
  ||!Number.isSafeInteger(r.applicationRevision)||r.applicationRevision<1
  ||typeof a.imageId!=='string'||!/^sha256:[0-9a-f]{64}$/.test(a.imageId)||!hex(a.bundleSha256)
  ||typeof a.sourceSha!=='string'||!/^[0-9a-f]{40}$/.test(a.sourceSha)||!hex(a.fingerprint))throw fail();
 return {protocol:RUNTIME_READINESS_PROTOCOL,challenge:raw.challenge,observedAt:raw.observedAt,
  runtime:{key:r.key,checksum:r.checksum,companyId:r.companyId,venueId:r.venueId,applicationRevision:r.applicationRevision},
  artifact:{imageId:a.imageId,bundleSha256:a.bundleSha256,sourceSha:a.sourceSha,fingerprint:a.fingerprint},
  authorization:{id:p.id,expiresAt:p.expiresAt},service:{state:'serving',scope:'tenant-api-only',published:false}};
}
function mac(packet,key){
 if(typeof key!=='string'||!RUNTIME_LAUNCH_KEY_PATTERN.test(key))throw fail();
 return crypto.createHmac('sha256',key).update(RUNTIME_READINESS_PROTOCOL+'\n'+JSON.stringify(packet)).digest('hex');
}
export function signRuntimeReadiness(raw,key){const packet=body(raw);return {...packet,mac:mac(packet,key)};}
export function verifyRuntimeReadiness(raw,{bundle:rawBundle,authorizationId,challenge,key,now=Date.now()}){
 if(!exact(raw,['protocol','challenge','observedAt','runtime','artifact','authorization','service','mac'])||!hex(raw.mac))throw fail();
 const {mac:signature,...unsigned}=raw,packet=body(unsigned),bundle=parseSpaceverseRuntimeBundle(rawBundle),m=bundle.manifest;
 if(bundle.schemaVersion!==3||!uuid.test(challenge)||!uuid.test(authorizationId)||packet.challenge!==challenge||packet.authorization.id!==authorizationId
  ||packet.runtime.key!==m.runtimeKey||packet.runtime.checksum!==m.manifestSha256||packet.runtime.companyId!==m.scope.companyId||packet.runtime.venueId!==m.scope.venueId
  ||packet.runtime.applicationRevision!==m.source.applicationRevision||packet.artifact.imageId!==bundle.artifact.imageRelease.imageId
  ||packet.artifact.bundleSha256!==bundle.bundleSha256||packet.artifact.sourceSha!==bundle.artifact.codeRelease.sourceSha
  ||packet.artifact.fingerprint!==bundle.artifact.codeRelease.fingerprint||!Number.isFinite(now)
  ||Date.parse(packet.observedAt)>now+2000||now-Date.parse(packet.observedAt)>30_000||Date.parse(packet.authorization.expiresAt)<=now
  ||!crypto.timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(mac(packet,key),'hex')))throw fail();
 return Object.freeze(packet);
}
