// Explicit local build-only operation: no migration, service start or network.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRuntimeRelease} from '../spaceverse-runtime-release.js';
const args=process.argv.slice(2);
if(args.length!==4||args[0]!=='--source-sha'||args[2]!=='--output'){
 console.error('Usage: node scripts/build-spaceverse-runtime-release.mjs --source-sha <40 hex> --output <new file>');process.exit(2);
}
try{
 const root=fileURLToPath(new URL('../',import.meta.url));
 const {stdout}=await promisify(execFile)('git',['rev-parse','--verify','HEAD'],{cwd:root});
 if(stdout.trim()!==args[1])throw Object.assign(new Error('Source commit mismatch'),{code:'RUNTIME_RELEASE_SOURCE_COMMIT_MISMATCH'});
 const release=await createRuntimeRelease(root,args[1]);
 await fs.writeFile(path.resolve(args[3]),JSON.stringify(release,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({sourceSha:release.sourceSha,fingerprint:release.fingerprint,moduleCount:release.files.length,coverage:release.coverage}));
}catch(error){console.error(error?.code?.startsWith('RUNTIME_RELEASE_')?error.code:'RUNTIME_RELEASE_BUILD_FAILED');process.exit(1);}
