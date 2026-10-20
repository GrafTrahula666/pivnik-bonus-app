import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import {createSpaceverseRuntimeManifest} from '../../../spaceverse-runtime-manifest.js'
import {seedOnboardingFixture} from './onboarding-fixture.js'
import {tenantCrmApplication} from './tenant-crm-fixture.js'
import {tenantCrmFixtureDatabase} from './tenant-crm-database-fixture.js'

// Metadata and three EMPTY, physically distinct databases. No legacy fixtures
// are removed to manufacture emptiness; native test databases are retained.
export async function emptyTenantFixture(copies:1|2=1,capacity=false){
  const metadata=await seedOnboardingFixture(await tenantCrmFixtureDatabase())
  if(capacity)await metadata.exec(await fs.readFile(new URL('../../admin-migrations/018_onboarding_database_capacity.sql',import.meta.url),'utf8'))
  const password=(await metadata.query<{password_hash:string}>('SELECT password_hash FROM admin_accounts WHERE id=11')).rows[0]!.password_hash
  await metadata.query(`INSERT INTO admin_accounts(id,email,display_name,role,password_hash)
    VALUES(21,'south@fixture.invalid','south','VENUE_ADMIN',$1)`,[password])
  await metadata.exec("INSERT INTO admin_company_access(admin_id,company_id,access_kind) VALUES(21,20,'owner'),(11,20,'owner')")
  const companies=copies===2?['10','10','20','10','10','20']:['10','10','20']
  const targets=await Promise.all(companies.map(()=>tenantCrmFixtureDatabase()))
  const manifests=[]
  for(const [index,companyId] of companies.entries()){
    const draftId=crypto.randomUUID(),runtimeKey='sv-'+draftId.replaceAll('-','')
    const venue=(await metadata.query<{id:string}>(`INSERT INTO venues(company_id,code,name,active)
      VALUES($1,$2,$3,FALSE) RETURNING id::text`,[companyId,runtimeKey,'CRM '+(index+1)])).rows[0]!
    await metadata.query(`INSERT INTO admin_onboarding_drafts(id,admin_id,company_id,request_key,initial_hash,data)
      VALUES($1,1,$2,$3,$4,$5)`,[draftId,companyId,crypto.randomUUID(),'a'.repeat(64),JSON.stringify({companyId,
      companyName:'',venueName:'CRM '+(index+1),address:'',timeZone:'Europe/Moscow',venueType:'cafe',ownerEmail:''})])
    await metadata.query('INSERT INTO admin_onboarding_app_configs(draft_id,tenant_key,config) VALUES($1,$2,$3)',
      [draftId,runtimeKey,JSON.stringify(tenantCrmApplication)])
    await metadata.query(`INSERT INTO admin_onboarding_scopes(draft_id,company_id,venue_id,
      company_created_by_onboarding,draft_revision,application_revision) VALUES($1,$2,$3,FALSE,1,1)`,[draftId,companyId,venue.id])
    manifests.push(createSpaceverseRuntimeManifest({draftId,runtimeKey,draftRevision:1,applicationRevision:1,
      scopeRevision:1,scope:{companyId,venueId:venue.id},config:tenantCrmApplication}))
  }
  const viewerInvite=crypto.randomUUID(),first=manifests[0]!
  await metadata.query(`INSERT INTO admin_onboarding_invites(id,draft_id,token_hash,created_by_admin_id,expires_at)
    VALUES($1,$2,$3,1,NOW()+INTERVAL '1 day')`,[viewerInvite,first.source.draftId,'b'.repeat(64)])
  await metadata.query(`INSERT INTO admin_onboarding_access(invitation_id,admin_id,company_id,venue_id,draft_id,role)
    VALUES($1,12,10,$2,$3,'manager')`,[viewerInvite,first.scope.venueId,first.source.draftId])
  return {metadata,targets,manifests,viewerInvite,
    registry:new Map(manifests.map((manifest,index)=>[manifest.runtimeKey,targets[index]!]))}
}
