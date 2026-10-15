import fs from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {createSpaceverseRuntimeBundle,type SpaceverseRuntimeManifest} from '../../spaceverse-runtime-manifest.js'
import {verifyRuntimeRelease} from '../../spaceverse-runtime-release.js'
import {verifyRuntimeImageInspection} from '../../spaceverse-runtime-image.js'

// Code approval belongs to the platform operator. The browser cannot nominate
// a revision, file, hash or executable. These values are non-secret references.
export async function assembleApprovedRuntimeBundle(manifest:SpaceverseRuntimeManifest,env:NodeJS.ProcessEnv=process.env){
 const sourceSha=env.ADMIN_RUNTIME_RELEASE_SHA??'',fingerprint=env.ADMIN_RUNTIME_RELEASE_FINGERPRINT??'',file=env.ADMIN_RUNTIME_RELEASE_MANIFEST_FILE??''
 const missing=()=>Object.assign(new Error('Runtime release is not registered.'),{code:'RUNTIME_RELEASE_NOT_REGISTERED'})
 if(!/^[0-9a-f]{40}$/.test(sourceSha)||!/^[0-9a-f]{64}$/.test(fingerprint)||!file)throw missing()
 const root=fileURLToPath(new URL('../../',import.meta.url))
 const stat=await fs.lstat(file).catch(()=>{throw missing()})
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>80_000)throw missing()
 const proof=await verifyRuntimeRelease(await fs.readFile(file,'utf8'),{root,expectedSourceSha:sourceSha,expectedFingerprint:fingerprint})
 const expectedImageId=env.ADMIN_RUNTIME_IMAGE_ID??'',imageFile=env.ADMIN_RUNTIME_IMAGE_INSPECTION_FILE??''
 const imageMissing=()=>Object.assign(new Error('Runtime image is not registered.'),{code:'RUNTIME_IMAGE_NOT_REGISTERED'})
 if(!/^sha256:[0-9a-f]{64}$/.test(expectedImageId)||!imageFile)throw imageMissing()
 const imageStat=await fs.lstat(imageFile).catch(()=>{throw imageMissing()})
 if(!imageStat.isFile()||imageStat.isSymbolicLink()||imageStat.size>80_000)throw imageMissing()
 let inspection:unknown
 try{inspection=JSON.parse(await fs.readFile(imageFile,'utf8'))}catch{throw imageMissing()}
 const image=verifyRuntimeImageInspection(inspection,{expectedImageId,codeRelease:proof})
 return createSpaceverseRuntimeBundle(manifest,proof,{imageId:image.imageId,platform:image.platform,contract:image.contract})
}
