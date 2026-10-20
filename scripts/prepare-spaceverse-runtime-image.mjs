// Explicit, reversible preparation of a new allowlisted build context. Does not
// build/run/push an image, execute source, create a DB or contact any provider.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRuntimeRelease,verifyRuntimeRelease} from '../spaceverse-runtime-release.js';
const root=fileURLToPath(new URL('../',import.meta.url)),args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--output'){
 process.stderr.write('Usage: node scripts/prepare-spaceverse-runtime-image.mjs --output <new context directory>\n');process.exit(2);
}
try{
 const directory=path.resolve(args[1]);await fs.mkdir(directory,{recursive:false,mode:0o700});
 const {stdout:source}=await promisify(execFile)('git',['rev-parse','--verify','HEAD'],{cwd:root});
 const sourceSha=source.trim(),release=await createRuntimeRelease(root,sourceSha);
 const {stdout:tracked}=await promisify(execFile)('git',['ls-files','-z'],{cwd:root,maxBuffer:4*1024*1024});
 const publicFiles=tracked.split('\0').filter(name=>name&&(
  (!name.includes('/')&&/\.(?:js|css|html|svg)$/.test(name))
  ||/^assets\/[a-zA-Z0-9_./-]+\.(?:svg|png|jpg|jpeg|webp|gif|woff|woff2|mp3|mp4)$/.test(name)
  ||/^migrations\/[0-9]{3}_[a-zA-Z0-9_-]+\.sql$/.test(name)));
 const files=new Set([...release.files.map(file=>file.path),...publicFiles,
  'spaceverse-runtime-release.js','scripts/spaceverse-runtime-container-entrypoint.mjs']);
 let total=0;
 for(const name of [...files].sort()){
  if(name.split('/').some(part=>!part||part==='..'||part.startsWith('.')))throw new Error();
  const from=path.resolve(root,name),stat=await fs.lstat(from),real=await fs.realpath(from);
  if(!stat.isFile()||stat.isSymbolicLink()||!real.startsWith(root)||stat.size>32*1024*1024)throw new Error();
  total+=stat.size;if(total>128*1024*1024)throw new Error();
  const to=path.join(directory,name);await fs.mkdir(path.dirname(to),{recursive:true});
  // The checkout/host may use umask 077. Public source inside the image must
  // remain readable by its non-root user, without making the context public.
  for(let parent=path.dirname(to);parent!==directory;parent=path.dirname(parent))await fs.chmod(parent,0o755);
  await fs.copyFile(from,to);await fs.chmod(to,0o644);
 }
 await fs.writeFile(path.join(directory,'spaceverse-runtime-release.json'),JSON.stringify(release,null,2)+'\n',{flag:'wx',mode:0o644});
 await fs.copyFile(path.join(root,'ops/spaceverse-runtime.Dockerfile'),path.join(directory,'Dockerfile'));
 // Host-side npm ci may populate the public cache in this context. The image
 // must install its own frozen dependencies, never copy host node_modules.
 await fs.writeFile(path.join(directory,'.dockerignore'),'node_modules\n.env*\n.npmrc\n',{flag:'wx',mode:0o644});
 for(const name of ['spaceverse-runtime-release.json','Dockerfile','.dockerignore'])await fs.chmod(path.join(directory,name),0o644);
 await verifyRuntimeRelease(release,{root:directory,expectedSourceSha:sourceSha,expectedFingerprint:release.fingerprint});
 process.stdout.write(JSON.stringify({sourceSha,fingerprint:release.fingerprint,moduleCount:release.files.length,contextFiles:files.size,contextBytes:total})+'\n');
}catch(error){
 process.stderr.write(error?.code==='EEXIST'?'SPACEVERSE_IMAGE_CONTEXT_EXISTS\n':'SPACEVERSE_IMAGE_CONTEXT_REJECTED\n');process.exitCode=1;
}
