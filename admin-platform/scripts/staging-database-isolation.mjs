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
