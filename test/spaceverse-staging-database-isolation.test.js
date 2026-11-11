import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {assertStagingDatabaseIsolation,approvedStagingIntegrationDatabaseUrl,STAGING_PROJECT_ID,STAGING_SERVICE_ID} from '../admin-platform/scripts/staging-database-isolation.mjs'

const good=()=>({
  RAILWAY_PROJECT_ID:STAGING_PROJECT_ID,
  RAILWAY_SERVICE_ID:STAGING_SERVICE_ID,
  ADMIN_ALLOW_TEST_SEED:'true',
  ADMIN_DATABASE_URL:'postgresql://fixture:synthetic-only@admin-postgres.railway.internal:5432/railway',
  ADMIN_READ_DATABASE_URL:'postgresql://reader:different-synthetic@admin-postgres.railway.internal:5432/railway',
  ADMIN_PRODUCTION_WRITE_DATABASE_URL:'postgresql://writer:different-synthetic@admin-postgres.railway.internal:5432/railway',
  ADMIN_ENABLE_PRODUCTION_BONUS_WRITES:'false',
  ADMIN_ENABLE_PRODUCTION_ACHIEVEMENT_WRITES:'false',
  ADMIN_ENABLE_PRODUCTION_ENTITLEMENT_WRITES:'false',
  ADMIN_ENABLE_EVOTOR_STOCK_WRITES:'false',
})

test('approved synthetic staging target passes without a database connection',()=>{
  assert.equal(assertStagingDatabaseIsolation(good()),good().ADMIN_DATABASE_URL)
})
for (const [label,change] of [
  ['wrong project', {RAILWAY_PROJECT_ID:'a-production-project'}],
  ['wrong service', {RAILWAY_SERVICE_ID:'a-production-service'}],
  ['no seed approval', {ADMIN_ALLOW_TEST_SEED:'false'}],
  ['public database host', {ADMIN_DATABASE_URL:'postgresql://fixture:secret@prod.example:5432/railway'}],
  ['unrelated private database host', {ADMIN_DATABASE_URL:'postgresql://fixture:secret@other-postgres.railway.internal:5432/railway'}],
  ['missing primary database', {ADMIN_DATABASE_URL:''}],
  ['mismatched reader host', {ADMIN_READ_DATABASE_URL:'postgresql://x:y@prod-postgres.railway.internal/railway'}],
  ['mismatched writer database', {ADMIN_PRODUCTION_WRITE_DATABASE_URL:'postgresql://x:y@admin-postgres.railway.internal/another_db'}],
  ['external bonus writes enabled', {ADMIN_ENABLE_PRODUCTION_BONUS_WRITES:'true'}],
  ['external achievement writes enabled', {ADMIN_ENABLE_PRODUCTION_ACHIEVEMENT_WRITES:'1'}],
  ['external entitlement writes enabled', {ADMIN_ENABLE_PRODUCTION_ENTITLEMENT_WRITES:'yes'}],
  ['Evotor stock writes enabled', {ADMIN_ENABLE_EVOTOR_STOCK_WRITES:'on'}],
  ['primary URL host override', {ADMIN_DATABASE_URL:good().ADMIN_DATABASE_URL+'?host=prod-postgres.railway.internal'}],
  ['reader URL host override', {ADMIN_READ_DATABASE_URL:good().ADMIN_READ_DATABASE_URL+'?host=prod-postgres.railway.internal'}],
  ['writer URL host override', {ADMIN_PRODUCTION_WRITE_DATABASE_URL:good().ADMIN_PRODUCTION_WRITE_DATABASE_URL+'?host=prod-postgres.railway.internal'}],
  ['primary database override', {ADMIN_DATABASE_URL:good().ADMIN_DATABASE_URL+'?db=other_database'}],
  ['reader port override', {ADMIN_READ_DATABASE_URL:good().ADMIN_READ_DATABASE_URL+'?port=25432'}],
  ['query with other options', {ADMIN_DATABASE_URL:good().ADMIN_DATABASE_URL+'?sslmode=require'}],
  ['URL fragment', {ADMIN_DATABASE_URL:good().ADMIN_DATABASE_URL+'#override'}],
  ['invalid URL', {ADMIN_DATABASE_URL:'this is not a URL'}],
]) {
  test('staging guard rejects '+label+' without exposing credentials',()=>{
    const env={...good(),...change}
    assert.throws(()=>assertStagingDatabaseIsolation(env),error=>{
      assert.match(error.message,/Staging preflight refused:/)
      assert.doesNotMatch(error.message,/synthetic-only|secret|different-synthetic|prod\.example/)
      return true
    })
  })
}


test('integration target is derived only after full staging preflight, without connecting',()=>{
  const url = new URL(approvedStagingIntegrationDatabaseUrl(good()))
  assert.equal(url.hostname,'admin-postgres.railway.internal')
  assert.equal(url.pathname,'/codex_admin_test_staging')
  assert.equal(url.search,'')
  assert.equal(url.hash,'')
})
for(const [label,override] of [
  ['another internal database',{ADMIN_DATABASE_URL:'postgresql://fixture:secret@different.railway.internal:5432/railway'}],
  ['mismatched writer',{ADMIN_PRODUCTION_WRITE_DATABASE_URL:'postgresql://x:secret@other.railway.internal/railway'}],
  ['different Railway service',{RAILWAY_SERVICE_ID:'unapproved-service'}],
  ['unapproved test seeding',{ADMIN_ALLOW_TEST_SEED:'false'}],
  ['external writing enabled',{ADMIN_ENABLE_PRODUCTION_BONUS_WRITES:'true'}],
  ['Postgres host override',{ADMIN_DATABASE_URL:good().ADMIN_DATABASE_URL+'?host=another.railway.internal'}],
]){
  test('integration target refuses '+label+' before spawning tests',()=>{
    assert.throws(()=>approvedStagingIntegrationDatabaseUrl({...good(),...override}),error=>{
      assert.match(error.message,/Staging preflight refused:/)
      assert.doesNotMatch(error.message,/secret|synthetic-only|different-synthetic/)
      return true
    })
  })
}

test('staging fixture seed invokes the full isolation guard before database access',()=>{
  const source=readFileSync(new URL('../admin-platform/server/seed-test-tenant.ts',import.meta.url),'utf8')
  assert.match(source,/import \{ assertStagingDatabaseIsolation \} from '\.\.\/scripts\/staging-database-isolation\.mjs'/)
  const gate=source.indexOf('assertStagingDatabaseIsolation()')
  const connect=source.indexOf('await pool.connect()')
  assert.ok(gate>0 && connect>gate,'Strict staging guard must run before opening a connection')
})
