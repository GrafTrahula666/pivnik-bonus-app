import crypto from 'node:crypto'
import type { PoolClient } from 'pg'
import { recordAudit } from './audit.js'
import { config } from './config.js'
import { pool } from './db.js'
import { hashPassword, randomToken, sha256 } from './security.js'
import { HttpError, type AdminPrincipal } from './types.js'
import { parseOwnerSignupInput } from './owner-signup.js'

/**
 * CHAT 04 #492. Internal-only durable verification primitive.
 * NOT mounted on any HTTP route: the public /auth/signup endpoint still returns 503.
 * Do not call until a real verified-delivery provider has been reviewed.
 * Tests can inject a synthetic delivery callback without contacting an external party.
 */
export type OwnerSignupDelivery = (email: string, verificationToken: string) => Promise<void>
type SignupState = { id: string; email: string; display_name: string; password_hash: string }

function gate(): void {
  if (!config.enableWrites || !config.enableOnboardingDrafts || !config.enableOwnerSignup) {
    throw new HttpError(403, 'OWNER_SIGNUP_DISABLED', 'Самостоятельная регистрация пока недоступна.')
  }
}
function unavailable(): HttpError {
  return new HttpError(503, 'OWNER_SIGNUP_STORAGE_UNAVAILABLE', 'Не удалось подтвердить регистрацию. Повторите попытку.')
}
const invalidToken = (): HttpError =>
  new HttpError(410, 'OWNER_SIGNUP_TOKEN_UNAVAILABLE', 'Ссылка подтверждения недоступна или срок её действия истёк.')

function safeDbError(error: unknown): never {
  if (error instanceof HttpError) throw error
  throw unavailable()
}
async function rollback(client: PoolClient): Promise<void> {
  await client.query('ROLLBACK').catch(() => undefined)
}

/**
 * Prepare a 30-minute single-use email challenge; never return the raw token
 * to the caller. The response is the same for a registered and an unregistered
 * email, and no new account or company exists yet. Delivery runs after COMMIT.
 */
export async function prepareOwnerSignupChallenge(
  raw: unknown,
  deliver: OwnerSignupDelivery | null,
): Promise<{ accepted: true }> {
  gate()
  if (typeof deliver !== 'function') {
    throw new HttpError(503, 'OWNER_SIGNUP_VERIFICATION_UNAVAILABLE', 'Подтверждение email ещё не настроено.')
  }
  const input = parseOwnerSignupInput(raw)
  const passwordHash = hashPassword(input.password)
  const token = randomToken(32)
  const tokenHash = sha256(token)
  let shouldDeliver = false
  const client = await pool.connect().catch(() => { throw unavailable() })
  try {
    await client.query('BEGIN')
    const existing = await client.query(
      'SELECT 1 FROM admin_accounts WHERE LOWER(email)=$1 LIMIT 1',
      [input.email],
    )
    if (!existing.rows.length) {
      await client.query(
        `INSERT INTO admin_owner_signup_challenges
           (id,email,display_name,password_hash,token_hash,expires_at)
         VALUES($1::uuid,$2,$3,$4,$5,NOW()+INTERVAL '30 minutes')
         ON CONFLICT(email) DO UPDATE SET
           id=EXCLUDED.id,display_name=EXCLUDED.display_name,
           password_hash=EXCLUDED.password_hash,token_hash=EXCLUDED.token_hash,
           created_at=NOW(),expires_at=EXCLUDED.expires_at,consumed_at=NULL`,
        [crypto.randomUUID(), input.email, input.displayName, passwordHash, tokenHash],
      )
      shouldDeliver = true
    }
    await client.query('COMMIT')
  } catch (error) {
    await rollback(client)
    safeDbError(error)
  } finally {
    client.release()
  }

  if (shouldDeliver) {
    try {
      await deliver(input.email, token)
    } catch {
      // A committed challenge is inert without the token. A subsequent request
      // rotates and invalidates it, so no false "delivered" success is returned.
      throw new HttpError(503, 'OWNER_SIGNUP_DELIVERY_UNAVAILABLE', 'Не удалось отправить подтверждение.')
    }
  }
  return { accepted: true }
}

/**
 * Consume exactly one still-live challenge and atomically create a VENUE_ADMIN
 * account WITHOUT company/venue membership. No session is issued here.
 * Explicit owner grants must be handled by separate canonical onboarding.
 */
export async function confirmOwnerSignupChallenge(token: unknown): Promise<{ admin: AdminPrincipal }> {
  gate()
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw invalidToken()
  const client = await pool.connect().catch(() => { throw unavailable() })
  try {
    await client.query('BEGIN')
    const row = (await client.query<SignupState>(
      `SELECT id::text,email,display_name,password_hash
       FROM admin_owner_signup_challenges
       WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>NOW()
       FOR UPDATE`, [sha256(token)],
    )).rows[0]
    if (!row) throw invalidToken()
    const collision = await client.query('SELECT 1 FROM admin_accounts WHERE LOWER(email)=$1 LIMIT 1', [row.email])
    if (collision.rows.length) throw invalidToken()
    const created = (await client.query<{ id: string }>(
      `INSERT INTO admin_accounts(email,display_name,role,password_hash)
       VALUES($1,$2,'VENUE_ADMIN',$3) RETURNING id::text`,
      [row.email,row.display_name,row.password_hash],
    )).rows[0]
    if (!created) throw unavailable()
    const admin: AdminPrincipal = { id: created.id, email: row.email, displayName: row.display_name, role: 'VENUE_ADMIN' }
    await client.query(
      'UPDATE admin_owner_signup_challenges SET consumed_at=NOW() WHERE id=$1::uuid',
      [row.id],
    )
    await recordAudit({
      admin, action: 'auth.owner_signup_verified', entityType: 'admin_account',
      entityId: admin.id, metadata: { emailVerified: true, noTenantGrant: true },
    }, client)
    await client.query('COMMIT')
    return { admin }
  } catch (error) {
    await rollback(client)
    safeDbError(error)
  } finally {
    client.release()
  }
}
