import type {SpaceverseRuntimeCodeRelease} from '../../../spaceverse-runtime-manifest.js'

// Synthetic inspection metadata only. It never proves a deployed image.
export const syntheticImageId='sha256:'+'1'.repeat(64)
export function syntheticImageInspection(proof:Pick<SpaceverseRuntimeCodeRelease,'sourceSha'|'fingerprint'>){
 return [{Id:syntheticImageId,Os:'linux',Architecture:'amd64',Config:{User:'node',WorkingDir:'/app',Entrypoint:null,
  Cmd:['node','scripts/spaceverse-runtime-container-entrypoint.mjs'],Env:['NODE_ENV=production','SPACEVERSE_RUNTIME_MODE=tenant'],
  Labels:{'org.opencontainers.image.source':'https://github.com/GrafTrahula666/pivnik-bonus-app',
   'org.opencontainers.image.revision':proof.sourceSha,'spaceverse.runtime.contract':'tenant-runtime-v1',
   'spaceverse.runtime.code-fingerprint':proof.fingerprint}}}]
}
