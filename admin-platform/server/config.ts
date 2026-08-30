import { HttpError } from './types.js'

const bool = (name: string, fallback=false) => {
  const raw=String(process.env[name] ?? '').trim().toLowerCase()
  return raw ? ['1','true','yes','on'].includes(raw) : fallback
}
const int = (name: string, fallback:number) => {
  const n=Number(process.env[name] ?? fallback)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}
export const config = {
  port: int('PORT', 4174),
  nodeEnv: String(process.env.NODE_ENV || 'development'),
  databaseUrl: String(process.env.ADMIN_DATABASE_URL || ''),
  readDatabaseUrl: String(process.env.ADMIN_READ_DATABASE_URL || process.env.ADMIN_DATABASE_URL || ''),
  productionWriteDatabaseUrl: String(process.env.ADMIN_PRODUCTION_WRITE_DATABASE_URL || ''),
  publicOrigin: String(process.env.ADMIN_PUBLIC_ORIGIN || '').replace(/\/+$/,''),
  csrfSecret: String(process.env.ADMIN_CSRF_SECRET || ''),
  sessionCookie: String(process.env.ADMIN_SESSION_COOKIE || (process.env.NODE_ENV==='production' ? '__Host-pivnik_admin_session' : 'pivnik_admin_session')),
  sessionTtlMs: int('ADMIN_SESSION_TTL_HOURS', 8) * 3600_000,
  secureCookies: bool('ADMIN_SECURE_COOKIES', process.env.NODE_ENV==='production'),
  trustProxy: bool('ADMIN_TRUST_PROXY', true),
  allowMigrations: bool('ADMIN_ALLOW_MIGRATIONS', false),
  enableWrites: bool('ADMIN_ENABLE_WRITES', false),
  enableProductionBonusWrites: bool('ADMIN_ENABLE_PRODUCTION_BONUS_WRITES', false),
  enableProductionAchievementWrites: bool('ADMIN_ENABLE_PRODUCTION_ACHIEVEMENT_WRITES', false),
  enableProductionEntitlementWrites: bool('ADMIN_ENABLE_PRODUCTION_ENTITLEMENT_WRITES', false),
  demoEnabled: bool('ADMIN_DEMO_ENABLED', true),
  staticDir: String(process.env.ADMIN_STATIC_DIR || 'dist'),
}
export const isProduction = config.nodeEnv === 'production'

export function validateRuntimeConfig(): void {
  if (!config.databaseUrl) throw new HttpError(500,'ADMIN_DATABASE_URL_MISSING','ADMIN_DATABASE_URL is required.')
  if (isProduction) {
    if (!process.env.ADMIN_READ_DATABASE_URL) throw new HttpError(500,'ADMIN_READ_DATABASE_URL_MISSING','Dedicated production reader is required.')
    if (!config.publicOrigin) throw new HttpError(500,'ADMIN_PUBLIC_ORIGIN_MISSING','ADMIN_PUBLIC_ORIGIN is required.')
    if (config.csrfSecret.length < 32) throw new HttpError(500,'ADMIN_CSRF_SECRET_WEAK','ADMIN_CSRF_SECRET must contain at least 32 characters.')
    if (!config.secureCookies) throw new HttpError(500,'ADMIN_SECURE_COOKIES_REQUIRED','Secure cookies are required.')
    if (config.enableProductionBonusWrites && !config.productionWriteDatabaseUrl) {
      throw new HttpError(500,'ADMIN_PRODUCTION_WRITE_DATABASE_URL_MISSING','Production bonus writes need a dedicated least-privilege writer.')
    }
  }
}
