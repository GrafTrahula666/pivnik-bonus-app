import type {SpaceverseRuntimeCodeRelease} from './spaceverse-runtime-manifest.js'
export function verifyRuntimeImageInspection(raw:unknown,options:{expectedImageId:string;codeRelease:SpaceverseRuntimeCodeRelease}):Readonly<{imageId:string;sourceSha:string;fingerprint:string;platform:'linux/amd64';contract:'tenant-runtime-v1';runtimeStatus:'not_provisioned';published:false}>
