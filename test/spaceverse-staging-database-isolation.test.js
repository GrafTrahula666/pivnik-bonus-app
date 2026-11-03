import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'
import {assertStagingDatabaseIsolation,STAGING_PROJECT_ID,STAGING_SERVICE_ID} from '../admin-platform/scripts/staging-database-isolation.mjs'

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

for (const command of ['run-staging-deploy.mjs','run-staging-integration.mjs']) {
  test('staging command '+command+' refuses to spawn a child with invalid scope',()=> {
    const script=fileURLToPath(new URL('../admin-platform/scripts/'+command,import.meta.url))
    const result=spawnSync(process.execPath,[script],{encoding:'utf8',env:{
      ...process.env,RAILWAY_PROJECT_ID:'wrong-scope',RAILWAY_SERVICE_ID:'wrong-scope',
      ADMIN_ALLOW_TEST_SEED:'true',ADMIN_DATABASE_URL:good().ADMIN_DATABASE_URL,
    }})
    assert.notEqual(result.status,0)
    assert.match(result.stderr,/Staging preflight refused:/)
    assert.doesNotMatch(result.stderr,/synthetic-only|password|secret/i)
  })
}
