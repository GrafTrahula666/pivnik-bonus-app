import type {TenantCrmFixtureDatabase} from './tenant-crm-database-fixture.js'

// Synthetic active points only; no customer data or live integrations.
export async function seedOwnerVenueSearch(metadata:Pick<TenantCrmFixtureDatabase,'query'>){
  await metadata.query(`INSERT INTO venues(company_id,code,name,active)
    SELECT 10,'search-'||i,'Каталог '||LPAD(i::text,3,'0'),TRUE FROM generate_series(1,301) i`)
  await metadata.query(`INSERT INTO venues(company_id,code,name,active) VALUES
    (20,'search-south','Каталог Юг',TRUE),(10,'search-literal','Точка 100%_плюс',TRUE)`)
}
