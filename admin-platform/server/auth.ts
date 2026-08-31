import type { QueryResultRow } from 'pg'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { pool } from './db.js'
import { config } from './config.js'
import {
  clearSessionCookie,
  csrfTokenFor,
  enforceRateLimit,
  hashIp,
  hashPassword,
  normalizeEmail,
  parseCookies,
  randomToken,
  requestIp,
  safeEqual,
  setSessionCookie,
  sha256,
  verifyPassword,
} from './security.js'
import { HttpError, type AdminPrincipal } from './types.js'

interface AccountRow extends QueryResultRow {
  id: string
  email: string
  display_name: string
  role: 'SUPER_ADMIN' | 'VENUE_ADMIN'
  password_hash: string
  active: boolean
}

interface SessionRow extends QueryResultRow {
  admin_id: string
  email: string
  display_name: string
  role: 'SUPER_ADMIN' | 'VENUE_ADMIN'
  active: boolean
  expires_at: string
}

function principalFrom(row: Pick<AccountRow, 'id' | 'email' | 'display_name' | 'role'>): AdminPrincipal {
  return {
    id: String(row.id),
    email: row.email,
    displayName: row.display_name,
    role: row.role,
  }
}

export async function login(
  req: IncomingMessage,
  res: ServerResponse,
  emailRaw: unknown,
  passwordRaw: unknown,
): Promise<{ admin: AdminPrincipal; csrfToken: string }> {
  const email = normalizeEmail(emailRaw)
  const password = String(passwordRaw ?? '')
  const ip = requestIp(req)
  enforceRateLimit(`admin-login:${ip}:${email}`, 6, 15 * 60 * 1000)

  const result = await pool.query<AccountRow>(
    `SELECT id::text, email, display_name, role, password_hash, active
     FROM admin_accounts
     WHERE LOWER(email) = $1
     LIMIT 1`,
    [email],
  )
  const account = result.rows[0]
  if (!account || !account.active || !verifyPassword(password, account.password_hash)) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Неверный email или пароль.')
  }

  const rawToken = randomToken(32)
  const tokenHash = sha256(rawToken)
  const expiresAt = new Date(Date.now() + config.sessionTtlMs)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO admin_sessions (
         token_hash, admin_id, expires_at, user_agent, ip_hash
       ) VALUES ($1, $2::bigint, $3, $4, $5)`,
      [
        tokenHash,
        account.id,
        expiresAt.toISOString(),
        String(req.headers['user-agent'] || '').slice(0, 500),
        hashIp(req),
      ],
    )
    await client.query(
      `UPDATE admin_accounts SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1::bigint`,
      [account.id],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }

  setSessionCookie(res, rawToken)
  return {
    admin: principalFrom(account),
    csrfToken: csrfTokenFor(rawToken),
  }
}

export async function loadSession(
  req: IncomingMessage,
): Promise<{ admin: AdminPrincipal; rawToken: string; csrfToken: string }> {
  const cookies = parseCookies(req.headers.cookie)
  const rawToken = String(cookies[config.sessionCookie] || '')
  if (!rawToken) {
    throw new HttpError(401, 'AUTH_REQUIRED', 'Требуется вход в Admin Platform.')
  }

  const result = await pool.query<SessionRow>(
    `SELECT
       s.admin_id::text,
       a.email,
       a.display_name,
       a.role,
       a.active,
       s.expires_at::text
     FROM admin_sessions s
     JOIN admin_accounts a ON a.id = s.admin_id
     WHERE s.token_hash = $1
       AND s.expires_at > NOW()
     LIMIT 1`,
    [sha256(rawToken)],
  )
  const row = result.rows[0]
  if (!row || !row.active) {
    throw new HttpError(401, 'SESSION_EXPIRED', 'Сессия администратора истекла.')
  }

  void pool.query(
    `UPDATE admin_sessions SET last_seen_at = NOW() WHERE token_hash = $1`,
    [sha256(rawToken)],
  ).catch(() => undefined)

  return {
    admin: {
      id: row.admin_id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
    },
    rawToken,
    csrfToken: csrfTokenFor(rawToken),
  }
}

export async function changePassword(
  admin: AdminPrincipal,
  rawToken: string,
  currentPasswordRaw: unknown,
  newPasswordRaw: unknown,
): Promise<{ ok: true; revokedSessions: number }> {
  const currentPassword = String(currentPasswordRaw ?? '')
  const newPassword = String(newPasswordRaw ?? '')
  enforceRateLimit(`admin-password-change:${admin.id}`, 6, 15 * 60 * 1000)
  if (!currentPassword) throw new HttpError(400, 'CURRENT_PASSWORD_REQUIRED', 'Введите текущий пароль.')

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query<AccountRow>(
      `SELECT id::text,email,display_name,role,password_hash,active
       FROM admin_accounts WHERE id=$1::bigint FOR UPDATE`,
      [admin.id],
    )
    const account = result.rows[0]
    if (!account || !account.active) throw new HttpError(401, 'AUTH_REQUIRED', 'Учётная запись недоступна.')
    if (!verifyPassword(currentPassword, account.password_hash)) {
      throw new HttpError(401, 'CURRENT_PASSWORD_INVALID', 'Текущий пароль указан неверно.')
    }
    if (verifyPassword(newPassword, account.password_hash)) {
      throw new HttpError(400, 'PASSWORD_UNCHANGED', 'Новый пароль должен отличаться от текущего.')
    }

    const passwordHash = hashPassword(newPassword)
    await client.query(
      `UPDATE admin_accounts SET password_hash=$1,updated_at=NOW() WHERE id=$2::bigint`,
      [passwordHash, admin.id],
    )
    const revoked = await client.query(
      `DELETE FROM admin_sessions WHERE admin_id=$1::bigint AND token_hash<>$2`,
      [admin.id, sha256(rawToken)],
    )
    await client.query('COMMIT')
    return { ok: true, revokedSessions: revoked.rowCount ?? 0 }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

export async function logout(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const cookies = parseCookies(req.headers.cookie)
  const rawToken = String(cookies[config.sessionCookie] || '')
  if (rawToken) {
    await pool.query(`DELETE FROM admin_sessions WHERE token_hash = $1`, [sha256(rawToken)])
  }
  clearSessionCookie(res)
}

export function requireCsrf(
  req: IncomingMessage,
  rawToken: string,
): void {
  const provided = String(req.headers['x-csrf-token'] || '')
  const expected = csrfTokenFor(rawToken)
  if (!provided || !safeEqual(provided, expected)) {
    throw new HttpError(403, 'CSRF_REJECTED', 'CSRF-проверка не пройдена.')
  }
}

export async function purgeExpiredSessions(): Promise<void> {
  await pool.query(`DELETE FROM admin_sessions WHERE expires_at <= NOW()`)
}
