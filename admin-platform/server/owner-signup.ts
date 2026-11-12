import type { IncomingMessage } from 'node:http'
import { config } from './config.js'
import { enforceRateLimit, normalizeEmail, requestIp, validatePasswordPolicy } from './security.js'
import { HttpError } from './types.js'

// CHAT 04 / #492: the initial boundary is deliberately incapable of issuing accounts.
// The next slice must supply verified, single-use email delivery and durable token
// persistence before any registration or owner grant can become available.
export interface OwnerSignupInput {
  email: string
  displayName: string
  password: string
}

const invalid = () => new HttpError(400, 'OWNER_SIGNUP_INVALID', 'Проверьте email, имя и пароль.')
const allowed = new Set(['email', 'displayName', 'password'])
const unsafeIdentityChars = /[\u0000-\u001f\u007f-\u009f\u061c\u200e-\u200f\u202a-\u202e\u2066-\u2069]/

export function parseOwnerSignupInput(raw: unknown): OwnerSignupInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid()
  const fields = raw as Record<string, unknown>
  if (Object.keys(fields).some(key => !allowed.has(key))) throw invalid()
  if (typeof fields.email !== 'string' || typeof fields.displayName !== 'string' || typeof fields.password !== 'string') {
    throw invalid()
  }
  const email = normalizeEmail(fields.email)
  const displayName = fields.displayName.trim()
  if (email.length > 254 || !/^[^\s@<>]{1,64}@[^\s@<>]+\.[^\s@<>]+$/.test(email) ||
      unsafeIdentityChars.test(email) || !displayName || displayName.length > 80 ||
      unsafeIdentityChars.test(displayName)) {
    throw invalid()
  }
  validatePasswordPolicy(fields.password)
  return { email, displayName, password: fields.password }
}

/**
 * This entrypoint is fail-closed even when the rollout flag is enabled.
 * An unverified email MUST NOT result in an admin account, company or role.
 * A later slice can replace the final 503 only after a durable verification flow,
 * independent security review and native-PostgreSQL tenant isolation checks.
 */
export function requestOwnerSignup(req: IncomingMessage, raw: unknown): never {
  if (!config.enableWrites || !config.enableOnboardingDrafts || !config.enableOwnerSignup) {
    throw new HttpError(403, 'OWNER_SIGNUP_DISABLED', 'Самостоятельная регистрация пока недоступна.')
  }
  // Process-local rate limits supplement, never replace, the shared ingress limiter.
  enforceRateLimit(`owner-signup-ip:${requestIp(req)}`, 6, 15 * 60_000)
  const input = parseOwnerSignupInput(raw)
  enforceRateLimit(`owner-signup-email:${input.email}`, 4, 15 * 60_000)
  throw new HttpError(503, 'OWNER_SIGNUP_VERIFICATION_UNAVAILABLE', 'Подтверждение email ещё не настроено. Учётная запись не создана.')
}
