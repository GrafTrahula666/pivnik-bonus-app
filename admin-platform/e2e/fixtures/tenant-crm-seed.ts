// Child process only. Synthetic local native PG URLs are passed through a pipe
// to the loopback test server; they are not printed in Playwright output.
if(!process.env.SPACEVERSE_TEST_NATIVE_POSTGRES_URL)throw new Error('Dedicated local PostgreSQL is required.')
const {tenantCrmFixture}=await import('../../server/tests/tenant-crm-fixture.js')
const fixture=await tenantCrmFixture()
try{
  await fixture.metadata.exec(`CREATE TABLE users(id BIGINT PRIMARY KEY,role TEXT,merged_into_user_id BIGINT,deleted_at TIMESTAMPTZ);
    CREATE TABLE bar_customers(bar_id BIGINT,user_id BIGINT,status TEXT)`)
  const registry:Record<string,{credentialEnv:string}>={},targets:Record<string,string>={}
  for(const [index,manifest] of fixture.manifests.entries()){
    const name='SPACEVERSE_TENANT_DATABASE_URL_CRM_E2E_'+index,url=fixture.targets[index]!.connectionString
    if(!url)throw new Error('Native test database URL is missing.')
    registry[manifest.runtimeKey]={credentialEnv:name};targets[name]=url
  }
  if(!fixture.metadata.connectionString)throw new Error('Native metadata URL is missing.')
  process.stdout.write(JSON.stringify({metadataUrl:fixture.metadata.connectionString,registry,targets}))
}finally{
  for(const db of fixture.targets)await db.close()
  await fixture.metadata.close()
}
