// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe,expect,it} from 'vitest'
import {createRuntimeRelease} from '../../../spaceverse-runtime-release.js'
import {createSpaceverseRuntimeManifest} from '../../../spaceverse-runtime-manifest.js'
import {assembleApprovedRuntimeBundle} from '../onboarding-runtime-release.js'
import {syntheticImageId,syntheticImageInspection} from './runtime-image-fixture.js'

describe('server-only approved release assembler',()=>{
 const manifest=createSpaceverseRuntimeManifest({draftId:'12345678-1234-4123-8123-123456789abc',runtimeKey:'sv-'+'1'.repeat(32),draftRevision:1,applicationRevision:1,scopeRevision:1,scope:{companyId:'10',venueId:'11'},config:{displayName:'Synthetic release',theme:'light',primaryColor:'#112233',secondaryColor:'#445566',shopEnabled:false,loyaltyEnabled:true}})
 it('empty operator registration never falls back to description-only success',async()=>{
  await expect(assembleApprovedRuntimeBundle(manifest,{})).rejects.toMatchObject({code:'RUNTIME_RELEASE_NOT_REGISTERED'})
 })
 it('real source modules require registered image too; wrong ID/config/source/file and changed release fail closed',async()=>{
  const root=fileURLToPath(new URL('../../../',import.meta.url)),sourceSha='a'.repeat(40)
  const release=await createRuntimeRelease(root,sourceSha),directory=await fs.mkdtemp(path.join(os.tmpdir(),'spaceverse-approved-'))
  const file=path.join(directory,'release.json');await fs.writeFile(file,JSON.stringify(release))
  const env={ADMIN_RUNTIME_RELEASE_SHA:sourceSha,ADMIN_RUNTIME_RELEASE_FINGERPRINT:release.fingerprint,ADMIN_RUNTIME_RELEASE_MANIFEST_FILE:file}
  await expect(assembleApprovedRuntimeBundle(manifest,env)).rejects.toMatchObject({code:'RUNTIME_IMAGE_NOT_REGISTERED'})
  const imageFile=path.join(directory,'image.json'),image=syntheticImageInspection(release)
  await fs.writeFile(imageFile,JSON.stringify(image))
  const completeEnv={...env,ADMIN_RUNTIME_IMAGE_ID:syntheticImageId,ADMIN_RUNTIME_IMAGE_INSPECTION_FILE:imageFile}
  const bundle=await assembleApprovedRuntimeBundle(manifest,completeEnv)
  expect(bundle).toMatchObject({schemaVersion:3,artifact:{codeRelease:{sourceSha,fingerprint:release.fingerprint},imageRelease:{imageId:syntheticImageId}},release:{runtimeStatus:'not_provisioned',published:false,startAllowed:false}})
  await expect(assembleApprovedRuntimeBundle(manifest,{...completeEnv,ADMIN_RUNTIME_IMAGE_ID:'spaceverse:latest'})).rejects.toMatchObject({code:'RUNTIME_IMAGE_NOT_REGISTERED'})
  await expect(assembleApprovedRuntimeBundle(manifest,{...completeEnv,ADMIN_RUNTIME_IMAGE_ID:'sha256:'+'2'.repeat(64)})).rejects.toMatchObject({code:'RUNTIME_IMAGE_MISMATCH'})
  image[0]!.Config.User='root';await fs.writeFile(imageFile,JSON.stringify(image))
  await expect(assembleApprovedRuntimeBundle(manifest,completeEnv)).rejects.toMatchObject({code:'RUNTIME_IMAGE_CONTRACT_INVALID'})
  image[0]!.Config.User='node';image[0]!.Config.Labels['org.opencontainers.image.revision']='b'.repeat(40);await fs.writeFile(imageFile,JSON.stringify(image))
  await expect(assembleApprovedRuntimeBundle(manifest,completeEnv)).rejects.toMatchObject({code:'RUNTIME_IMAGE_CONTRACT_INVALID'})
  const imageLink=path.join(directory,'image-link.json');await fs.symlink(imageFile,imageLink)
  await expect(assembleApprovedRuntimeBundle(manifest,{...completeEnv,ADMIN_RUNTIME_IMAGE_INSPECTION_FILE:imageLink})).rejects.toMatchObject({code:'RUNTIME_IMAGE_NOT_REGISTERED'})
  await fs.writeFile(imageFile,'invalid JSON')
  await expect(assembleApprovedRuntimeBundle(manifest,completeEnv)).rejects.toMatchObject({code:'RUNTIME_IMAGE_NOT_REGISTERED'})
  await expect(assembleApprovedRuntimeBundle(manifest,{...env,ADMIN_RUNTIME_RELEASE_SHA:'b'.repeat(40)})).rejects.toMatchObject({code:'RUNTIME_RELEASE_MISMATCH'})
  await expect(assembleApprovedRuntimeBundle(manifest,{...env,ADMIN_RUNTIME_RELEASE_FINGERPRINT:'b'.repeat(64)})).rejects.toMatchObject({code:'RUNTIME_RELEASE_MISMATCH'})
  await fs.writeFile(file,JSON.stringify({...release,credential:'not allowed'}))
  await expect(assembleApprovedRuntimeBundle(manifest,env)).rejects.toMatchObject({code:'RUNTIME_RELEASE_INVALID'})
  const link=path.join(directory,'link.json');await fs.symlink(file,link)
  await expect(assembleApprovedRuntimeBundle(manifest,{...env,ADMIN_RUNTIME_RELEASE_MANIFEST_FILE:link})).rejects.toMatchObject({code:'RUNTIME_RELEASE_NOT_REGISTERED'})
 })
})
