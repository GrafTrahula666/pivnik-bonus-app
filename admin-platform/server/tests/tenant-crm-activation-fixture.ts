import fs from 'node:fs/promises'
import {tenantCrmFixture} from './tenant-crm-fixture.js'

// Synthetic data only. Add the complete tenant schema required for activation
// to the existing physically isolated CRM fixtures, without guest artifacts.
export async function tenantCrmActivationFixture(){
  const fixture=await tenantCrmFixture()
  const password=(await fixture.metadata.query<{password_hash:string}>('SELECT password_hash FROM admin_accounts WHERE id=11')).rows[0]!.password_hash
  await fixture.metadata.query(`INSERT INTO admin_accounts(id,email,display_name,role,password_hash)
    VALUES(31,'network-owner@fixture.invalid','Network owner','VENUE_ADMIN',$1)`,[password])
  await fixture.metadata.exec("INSERT INTO admin_company_access(admin_id,company_id,access_kind) VALUES(31,10,'owner'),(31,20,'owner'); SELECT setval('admin_accounts_id_seq',(SELECT MAX(id) FROM admin_accounts))")
  for(const [index,db] of fixture.targets.entries()){
    const manifest=fixture.manifests[index]!
    // Canonical venue labels are what the owner list displays; keep them
    // distinct and aligned with the corresponding resumable draft labels.
    await fixture.metadata.query('UPDATE venues SET name=$1 WHERE id=$2',['CRM '+(index+1),manifest.scope.venueId])
    await db.exec(`ALTER TABLE users ADD COLUMN telegram_id BIGINT UNIQUE;
      ALTER TABLE users ADD COLUMN session_version BIGINT NOT NULL DEFAULT 1;
      CREATE TABLE user_identities(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,provider_user_id TEXT NOT NULL,provider_username TEXT,
        UNIQUE(provider,provider_user_id),UNIQUE(user_id,provider));
      CREATE TABLE transactions(id BIGSERIAL PRIMARY KEY,request_key TEXT UNIQUE,
        client_id BIGINT NOT NULL REFERENCES users(id),mode TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'completed');`)
    for(const file of ['009_spaceverse_tenant_attribution.sql','020_spaceverse_customer_create_requests.sql'])
      await db.exec(await fs.readFile(new URL('../../../migrations/'+file,import.meta.url),'utf8'))
    // All rows in this activation-only seed are synthetic owned customers.
    await db.query(`INSERT INTO spaceverse_customer_ownership(user_id,runtime_key,company_id,venue_id)
      VALUES(2,$1,$2,$3)`,[manifest.runtimeKey,manifest.scope.companyId,manifest.scope.venueId])
    for(const step of ['runtime_database_binding','tenant_schema_readiness'])
      await fixture.metadata.query(`INSERT INTO admin_onboarding_provisioning_steps(
        draft_id,step,runtime_key,manifest_sha256,application_revision,company_id,venue_id,status,attempt_count,result)
        VALUES($1,$2,$3,$4,1,$5,$6,'succeeded',1,$7)`,
      [manifest.source.draftId,step,manifest.runtimeKey,manifest.manifestSha256,manifest.scope.companyId,manifest.scope.venueId,
        JSON.stringify(step==='runtime_database_binding'?{binding:'verified_existing'}:
          {schema:'verified',migrationSet:'009,017-020',ownershipBoundary:'verified'})])
  }
  return fixture
}
