// Immutable local image identity/contract, never a mutable tag or a launch.
const digest=value=>typeof value==='string'&&/^sha256:[0-9a-f]{64}$/.test(value);
const fail=code=>Object.assign(new Error('Runtime image cannot be verified.'),{code});
const allowedEnvironment=new Set(['PATH','NODE_VERSION','YARN_VERSION','NODE_ENV','SPACEVERSE_RUNTIME_MODE']);
export function verifyRuntimeImageInspection(raw,{expectedImageId,codeRelease}){
 if(!digest(expectedImageId)||!codeRelease||!/^[0-9a-f]{40}$/.test(codeRelease.sourceSha??'')
  ||!/^[0-9a-f]{64}$/.test(codeRelease.fingerprint??''))throw fail('RUNTIME_IMAGE_NOT_REGISTERED');
 const data=Array.isArray(raw)&&raw.length===1?raw[0]:raw;
 if(!data||typeof data!=='object'||data.Id!==expectedImageId||data.Os!=='linux'||data.Architecture!=='amd64')throw fail('RUNTIME_IMAGE_MISMATCH');
 const config=data.Config,labels=config?.Labels,env=config?.Env;
 if(!config||config.User!=='node'||config.WorkingDir!=='/app'
  ||!(config.Entrypoint===null||Array.isArray(config.Entrypoint)&&config.Entrypoint.length===0)
  ||JSON.stringify(config.Cmd)!==JSON.stringify(['node','scripts/spaceverse-runtime-container-entrypoint.mjs'])
  ||!labels||labels['org.opencontainers.image.source']!=='https://github.com/GrafTrahula666/pivnik-bonus-app'
  ||labels['org.opencontainers.image.revision']!==codeRelease.sourceSha
  ||labels['spaceverse.runtime.contract']!=='tenant-runtime-v1'
  ||labels['spaceverse.runtime.code-fingerprint']!==codeRelease.fingerprint
  ||!Array.isArray(env)||!env.includes('SPACEVERSE_RUNTIME_MODE=tenant')||!env.includes('NODE_ENV=production')
  ||env.some(value=>typeof value!=='string'||!allowedEnvironment.has(value.split('=',1)[0]))
  ||new Set(env.map(value=>value.split('=',1)[0])).size!==env.length)throw fail('RUNTIME_IMAGE_CONTRACT_INVALID');
 return Object.freeze({imageId:expectedImageId,sourceSha:codeRelease.sourceSha,fingerprint:codeRelease.fingerprint,
  platform:'linux/amd64',contract:'tenant-runtime-v1',runtimeStatus:'not_provisioned',published:false});
}
