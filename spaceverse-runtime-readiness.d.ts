import type {SpaceverseRuntimeBundle} from './spaceverse-runtime-manifest.js'
export const RUNTIME_READINESS_PROTOCOL:'spaceverse-runtime-readiness-v1'
export const RUNTIME_LAUNCH_KEY_PATTERN:RegExp
export interface RuntimeReadinessPacket {
 protocol:'spaceverse-runtime-readiness-v1'
 challenge:string
 observedAt:string
 runtime:{key:string;checksum:string;companyId:string;venueId:string;applicationRevision:number}
 artifact:{imageId:string;bundleSha256:string;sourceSha:string;fingerprint:string}
 authorization:{id:string;expiresAt:string}
 service:{state:'serving';scope:'tenant-api-only';published:false}
 mac:string
}
export function signRuntimeReadiness(raw:Omit<RuntimeReadinessPacket,'mac'>,key:string):RuntimeReadinessPacket
export function verifyRuntimeReadiness(raw:unknown,expected:{bundle:SpaceverseRuntimeBundle;authorizationId:string;challenge:string;key:string;now?:number}):Readonly<Omit<RuntimeReadinessPacket,'mac'>>
