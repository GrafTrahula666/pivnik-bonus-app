import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import {createSpaceverseRuntimeManifest,type SpaceverseRuntimeManifest} from '../../../spaceverse-runtime-manifest.js'
import {seedOnboardingFixture} from './onboarding-fixture.js'
import {tenantCrmFixtureDatabase,type TenantCrmFixtureDatabase} from './tenant-crm-database-fixture.js'

export const tenantCrmApplication = { displayName: 'Synthetic CRM', theme: 'premium-dark' as const,
    primaryColor: '#73bcd9', secondaryColor: '#172c36', shopEnabled: true, loyaltyEnabled: true }

// Synthetic metadata and three physically separate target databases. Used by
// signed HTTP regression and the built-panel E2E; optional native PG stays local.
export async function tenantCrmFixture(){
  const application=tenantCrmApplication
  const manifests:SpaceverseRuntimeManifest[]=[],targets:TenantCrmFixtureDatabase[]=[]
  const registry=new Map<string,TenantCrmFixtureDatabase>()
  const metadata = await seedOnboardingFixture(await tenantCrmFixtureDatabase())
  const passwordHash = (await metadata.query<{ password_hash: string }>('SELECT password_hash FROM admin_accounts WHERE id=11')).rows[0]!.password_hash
  await metadata.query(`INSERT INTO admin_accounts(id,email,display_name,role,password_hash)
    VALUES(21,'south@fixture.invalid','south','VENUE_ADMIN',$1)`, [passwordHash])
  await metadata.exec("INSERT INTO admin_company_access(admin_id,company_id,access_kind) VALUES(21,20,'owner')")
  for (const [index, company] of ['10', '10', '20'].entries()) {
    const draftId = crypto.randomUUID(), runtimeKey = 'sv-' + draftId.replaceAll('-', '')
    const venue = (await metadata.query<{ id: string }>(`INSERT INTO venues(company_id,code,name,active)
    VALUES($1,$2,'Synthetic CRM',FALSE) RETURNING id::text`, [company, runtimeKey])).rows[0]!
    await metadata.query(`INSERT INTO admin_onboarding_drafts(id,admin_id,company_id,request_key,initial_hash,data)
    VALUES($1,1,$2,$3,$4,$5)`, [draftId, company, crypto.randomUUID(), 'a'.repeat(64),
      JSON.stringify({companyId:company,companyName:'',venueName:'CRM '+(index+1),address:'',timeZone:'Europe/Moscow',venueType:'cafe',ownerEmail:''})])
    await metadata.query('INSERT INTO admin_onboarding_app_configs(draft_id,tenant_key,config) VALUES($1,$2,$3)',
    [draftId, runtimeKey, JSON.stringify(application)])
    await metadata.query(`INSERT INTO admin_onboarding_scopes(draft_id,company_id,venue_id,
    company_created_by_onboarding,draft_revision,application_revision) VALUES($1,$2,$3,FALSE,1,1)`, [draftId, company, venue.id])
    const manifest = createSpaceverseRuntimeManifest({ draftId, runtimeKey, draftRevision: 1,
    applicationRevision: 1, scopeRevision: 1, scope: { companyId: company, venueId: venue.id }, config: application })
    manifests.push(manifest)
    const db = await tenantCrmFixtureDatabase(); targets.push(db)
    for (const file of ['017_spaceverse_runtime_binding.sql', '018_spaceverse_runtime_scope_binding.sql'])
    await db.exec(await fs.readFile(new URL('../../../migrations/' + file, import.meta.url), 'utf8'))
    await db.exec(`CREATE TABLE users(id BIGINT PRIMARY KEY,username TEXT,first_name TEXT,last_name TEXT,photo_url TEXT,
    role TEXT DEFAULT 'client',deleted_at TIMESTAMPTZ,merged_into_user_id BIGINT);
    CREATE TABLE wallets(user_id BIGINT PRIMARY KEY REFERENCES users(id),balance BIGINT,updated_at TIMESTAMPTZ DEFAULT NOW());
    INSERT INTO users(id,first_name) VALUES(1,'Owned'),(2,'Historical'),(3,'No wallet'),(4,'Deleted'),(5,'Staff'),(6,'Zero'),(7,'Large');
    UPDATE users SET deleted_at=NOW() WHERE id=4; UPDATE users SET role='staff' WHERE id=5;`)
    await db.exec(await fs.readFile(new URL('../../../migrations/019_spaceverse_customer_ownership.sql', import.meta.url), 'utf8'))
    await db.query(`INSERT INTO spaceverse_runtime_binding(singleton,runtime_key,manifest_sha256,manifest_revision,
    company_id,venue_id,isolation_policy,status) VALUES(TRUE,$1,$2,1,$3,$4,'dedicated_database','prepared')`,
    [runtimeKey, manifest.manifestSha256, company, venue.id])
    for (const id of [1, 3, 4, 5, 6, 7]) await db.query(`INSERT INTO spaceverse_customer_ownership(user_id,runtime_key,company_id,venue_id)
    VALUES($1,$2,$3,$4)`, [id, runtimeKey, company, venue.id])
    await db.query('INSERT INTO wallets(user_id,balance) VALUES(1,$1),(2,999),(6,0),(7,9007199254740993)', [String(101 + index)])
    registry.set(runtimeKey, db)
  }
  const firstDb=targets[0]!,firstManifest=manifests[0]!
  await firstDb.exec("INSERT INTO users(id,first_name) VALUES(8,'Анна_100%'); INSERT INTO users(id,first_name) SELECT id,'Pagination fixture '||(id-1000)::text FROM generate_series(1000,1349) id")
  await firstDb.query(`INSERT INTO spaceverse_customer_ownership(user_id,runtime_key,company_id,venue_id)
    SELECT id,$1,$2,$3 FROM users WHERE id=8 OR id BETWEEN 1000 AND 1349`,
    [firstManifest.runtimeKey,firstManifest.scope.companyId,firstManifest.scope.venueId])
  const viewerInvite = crypto.randomUUID()
  const first = manifests[0]!
  await metadata.query(`INSERT INTO admin_onboarding_invites(id,draft_id,token_hash,created_by_admin_id,expires_at)
    VALUES($1,$2,$3,1,NOW()+INTERVAL '1 day')`, [viewerInvite, first.source.draftId, 'b'.repeat(64)])
  await metadata.query(`INSERT INTO admin_onboarding_access(invitation_id,admin_id,company_id,venue_id,draft_id,role)
    VALUES($1,12,10,$2,$3,'manager')`, [viewerInvite, first.scope.venueId, first.source.draftId])
  return {metadata,targets,manifests,registry,viewerInvite}
}
