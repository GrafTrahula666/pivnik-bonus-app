// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe,expect,it} from 'vitest'
import {createRuntimeRelease} from '../../../spaceverse-runtime-release.js'
import {createSpaceverseRuntimeManifest} from '../../../spaceverse-runtime-manifest.js'
import {assembleApprovedRuntimeBundle} from '../onboarding-runtime-release.js'

describe('server-only approved release assembler',()=>{
 const manifest=createSpaceverseRuntimeManifest({draftId:'12345678-1234-4123-8123-123456789abc',runtimeKey:'sv-'+'1'.repeat(32),draftRevision:1,applicationRevision:1,scopeRevision:1,scope:{companyId:'10',venueId:'11'},config:{displayName:'Synthetic release',theme:'light',primaryColor:'#112233',secondaryColor:'#445566',shopEnabled:false,loyaltyEnabled:true}})
 it('empty operator registration never falls back to description-only success',async()=>{
  await expect(assembleApprovedRuntimeBundle(manifest,{})).rejects.toMatchObject({code:'RUNTIME_RELEASE_NOT_REGISTERED'})
 })
 it('real source modules produce v2 only with exact approved fingerprint; wrong SHA/fingerprint and damaged manifest fail closed',async()=>{
  const root=fileURLToPath(new URL('../../../',import.meta.url)),sourceSha='a'.repeat(40)
  const release=await createRuntimeRelease(root,sourceSha),directory=await fs.mkdtemp(path.join(os.tmpdir(),'spaceverse-approved-'))
  const file=path.join(directory,'release.json');await fs.writeFile(file,JSON.stringify(release))
  const env={ADMIN_RUNTIME_RELEASE_SHA:sourceSha,ADMIN_RUNTIME_RELEASE_FINGERPRINT:release.fingerprint,ADMIN_RUNTIME_RELEASE_MANIFEST_FILE:file}
  const bundle=await assembleApprovedRuntimeBundle(manifest,env)
  expect(bundle).toMatchObject({schemaVersion:2,artifact:{codeRelease:{sourceSha,fingerprint:release.fingerprint}},release:{runtimeStatus:'not_provisioned',published:false,startAllowed:false}})
  await expect(assembleApprovedRuntimeBundle(manifest,{...env,ADMIN_RUNTIME_RELEASE_SHA:'b'.repeat(40)})).rejects.toMatchObject({code:'RUNTIME_RELEASE_MISMATCH'})
  await expect(assembleApprovedRuntimeBundle(manifest,{...env,ADMIN_RUNTIME_RELEASE_FINGERPRINT:'b'.repeat(64)})).rejects.toMatchObject({code:'RUNTIME_RELEASE_MISMATCH'})
  await fs.writeFile(file,JSON.stringify({...release,credential:'not allowed'}))
  await expect(assembleApprovedRuntimeBundle(manifest,env)).rejects.toMatchObject({code:'RUNTIME_RELEASE_INVALID'})
  const link=path.join(directory,'link.json');await fs.symlink(file,link)
  await expect(assembleApprovedRuntimeBundle(manifest,{...env,ADMIN_RUNTIME_RELEASE_MANIFEST_FILE:link})).rejects.toMatchObject({code:'RUNTIME_RELEASE_NOT_REGISTERED'})
 })
})
