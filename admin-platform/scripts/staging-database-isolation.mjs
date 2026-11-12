// Fail-closed gate for an existing Railway staging project; pure and safe to unit-test.
// This prevents a historical staging:deploy fixture seed from contacting another DB.
export const STAGING_PROJECT_ID = '472996fe-c85d-4bda-bb72-2c96f7e5030f'
export const STAGING_SERVICE_ID = 'c9441ae5-7fe9-4030-9b61-3cd8238f94f3'
const EXPECTED_DB_HOST = 'admin-postgres.railway.internal'
const EXTERNAL_WRITE_FLAGS = [
  'ADMIN_ENABLE_PRODUCTION_BONUS_WRITES',
  'ADMIN_ENABLE_PRODUCTION_ACHIEVEMENT_WRITES',
  'ADMIN_ENABLE_PRODUCTION_ENTITLEMENT_WRITES',
  'ADMIN_ENABLE_EVOTOR_STOCK_WRITES',
]
function parseDatabaseTarget(raw, key) {
  if (!raw) throw new Error('Staging preflight refused: '+key+' missing.')
  let url
  try { url = new URL(raw) } catch { throw new Error('Staging preflight refused: invalid '+key+'.') }
  // pg-connection-string permits ?host=... to override the URL hostname.
  // No query parameters or fragments are needed for this internal-only staging target.
  if (url.search || url.hash) {
    throw new Error('Staging preflight refused: '+key+' has unsupported connection parameters.')
  }
  if (!['postgres:','postgresql:'].includes(url.protocol) ||
      url.hostname !== EXPECTED_DB_HOST || !url.pathname || url.pathname === '/') {
    throw new Error('Staging preflight refused: '+key+' is not the approved staging database.')
  }
  return {host:url.hostname,port:url.port||'5432',database:url.pathname}
}
export function assertStagingDatabaseIsolation(env=process.env) {
  if (env.RAILWAY_PROJECT_ID !== STAGING_PROJECT_ID || env.RAILWAY_SERVICE_ID !== STAGING_SERVICE_ID) {
    throw new Error('Staging preflight refused: unexpected Railway project/service.')
  }
  if (env.ADMIN_ALLOW_TEST_SEED !== 'true') {
    throw new Error('Staging preflight refused: test seed was not explicitly enabled.')
  }
  for (const flag of EXTERNAL_WRITE_FLAGS) {
    if (['true','1','on','yes'].includes(String(env[flag]||'').trim().toLowerCase())) {
      throw new Error('Staging preflight refused: cross-service write capability '+flag+' must be disabled.')
    }
  }
  const raw=String(env.ADMIN_DATABASE_URL||'').trim()
  const target=parseDatabaseTarget(raw,'ADMIN_DATABASE_URL')
  for (const key of ['ADMIN_READ_DATABASE_URL','ADMIN_PRODUCTION_WRITE_DATABASE_URL']) {
    const other=String(env[key]||'').trim()
    if (!other) continue
    const candidate=parseDatabaseTarget(other,key)
    if (candidate.host!==target.host || candidate.port!==target.port || candidate.database!==target.database) {
      throw new Error('Staging preflight refused: '+key+' targets a different database.')
    }
  }
  return raw
}

// All integration tests must reuse the same exact project/service, DB hostname,
// read/write-target and dangerous-write-flag gate as staging preflight.
// Returning the connection string is intentional: callers pass it to a child
// environment, never to logs or a GitHub artifact.
export function approvedStagingIntegrationDatabaseUrl(env=process.env) {
  const approved = assertStagingDatabaseIsolation(env)
  const url = new URL(approved)
  url.pathname = '/codex_admin_test_staging'
  return url.toString()
}

// A standalone db:migrate on the known staging project is just as dangerous
// as a direct seed. Production projects retain their own migration policy.
export function assertStagingMigrationIsolation(env=process.env) {
  const project=String(env.RAILWAY_PROJECT_ID||'')
  const service=String(env.RAILWAY_SERVICE_ID||'')
  if(project===STAGING_PROJECT_ID || service===STAGING_SERVICE_ID){
    assertStagingDatabaseIsolation(env)
    return
  }
  // A local command pointed at the staging internal hostname must not skip
  // the project/service gate simply because Railway metadata is absent.
  if(!project){
    let host
    try{host=new URL(String(env.ADMIN_DATABASE_URL||'')).hostname}catch{}
    if(host===EXPECTED_DB_HOST){
      throw new Error('Staging preflight refused: missing Railway project identity for staging migration.')
    }
  }
}


// Read-only, non-secret operator attestation. This evaluates the *current*
// Railway process environment and never opens a database connection.
// It cannot prove volume persistence, restore capability, or live tenancy.
export function summarizeStagingDatabaseIsolation(env=process.env) {
  const present = key => Boolean(String(env[key]||'').trim())
  const target = key => {
    if(!present(key))return null
    try{return parseDatabaseTarget(String(env[key]).trim(),key)}catch{return false}
  }
  const primary=target('ADMIN_DATABASE_URL')
  const reader=target('ADMIN_READ_DATABASE_URL')
  const writer=target('ADMIN_PRODUCTION_WRITE_DATABASE_URL')
  const sameTarget = other => {
    if(other===null)return null
    if(!primary||!other)return false
    return primary.host===other.host&&primary.port===other.port&&primary.database===other.database
  }
  const enabled = value => ['true','1','on','yes'].includes(String(value||'').trim().toLowerCase())
  let isolationGatePassed=false
  try{assertStagingDatabaseIsolation(env);isolationGatePassed=true}catch{
    // Intentionally do not serialize the error, input URLs or credentials.
  }
  return {
    schemaVersion:1,
    environment:'pivnik-admin-staging',
    projectAndServiceMatch:env.RAILWAY_PROJECT_ID===STAGING_PROJECT_ID&&env.RAILWAY_SERVICE_ID===STAGING_SERVICE_ID,
    database:{
      primary:{configured:present('ADMIN_DATABASE_URL'),approvedTarget:Boolean(primary)},
      reader:{configured:present('ADMIN_READ_DATABASE_URL'),matchesPrimary:sameTarget(reader)},
      writer:{configured:present('ADMIN_PRODUCTION_WRITE_DATABASE_URL'),matchesPrimary:sameTarget(writer)},
    },
    flags:{
      testSeedEnabled:env.ADMIN_ALLOW_TEST_SEED==='true',
      migrationsEnabled:env.ADMIN_ALLOW_MIGRATIONS==='true',
      adminWritesEnabled:enabled(env.ADMIN_ENABLE_WRITES),
      externalProductionWritesDisabled:EXTERNAL_WRITE_FLAGS.every(flag=>!enabled(env[flag])),
    },
    isolationGatePassed,
    credentialsPrinted:false,
    persistentVolumeAndRestoreVerified:false,
    realTwoTenantAcceptanceVerified:false,
    deployApproved:false,
  }
}
