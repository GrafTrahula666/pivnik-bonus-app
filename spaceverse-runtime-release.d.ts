export interface RuntimeRelease{
 schemaVersion:1;artifact:'pivnik-bonus-app';contract:'tenant-runtime-v1';coverage:'node_literal_import_closure'
 sourceSha:string;entrypoints:string[];files:{path:string;size:number;sha256:string}[];fingerprint:string
}
export const RUNTIME_RELEASE_ENTRYPOINTS:readonly string[]
export function createRuntimeRelease(root:string,sourceSha:string):Promise<RuntimeRelease>
export function parseRuntimeRelease(raw:unknown):RuntimeRelease
export function verifyRuntimeRelease(raw:unknown,options:{root:string;expectedSourceSha:string;expectedFingerprint:string}):Promise<Readonly<{sourceSha:string;fingerprint:string;coverage:'node_literal_import_closure';moduleCount:number}>>
