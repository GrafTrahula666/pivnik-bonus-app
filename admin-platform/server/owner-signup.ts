import type { IncomingMessage } from 'node:http'
import { config } from './config.js'
import { enforceRateLimit, normalizeEmail, requestIp, validatePasswordPolicy } from './security.js'
import { HttpError } from './types.js'

// CHAT 04 / #492: validate and throttle self-service signup before the durable
// challenge service. Account creation remains impossible until a single-use token
// is redeemed; delivery is supplied separately and defaults to unavailable.
export interface OwnerSignupInput {
  email: string
  displayName: string
  password: string
}

const invalid = () => new HttpError(400, 'OWNER_SIGNUP_INVALID', 'Проверьте email, имя и пароль.')
const allowed = new Set(['email', 'displayName', 'password'])
const unsafeIdentityChars = (value: string): boolean => Array.from(value).some(character => {
  const code = character.codePointAt(0) ?? 0
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f) ||
    code === 0x061c || (code >= 0x200e && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)
})

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
      unsafeIdentityChars(email) || !displayName || displayName.length > 80 ||
      unsafeIdentityChars(displayName)) {
    throw invalid()
  }
  validatePasswordPolicy(fields.password)
  return { email, displayName, password: fields.password }
}

/**
 * Validate and throttle the request only. This function never persists credentials
 * or grants access; the durable challenge service owns verification and redemption.
 */
export function requestOwnerSignup(req: IncomingMessage, raw: unknown): OwnerSignupInput {
  if (!config.enableWrites || !config.enableOnboardingDrafts || !config.enableOwnerSignup) {
    throw new HttpError(403, 'OWNER_SIGNUP_DISABLED', 'Самостоятельная регистрация пока недоступна.')
  }
  // Process-local limits supplement, never replace, the shared ingress limiter.
  enforceRateLimit(`owner-signup-ip:${requestIp(req)}`, 6, 15 * 60_000)
  const input = parseOwnerSignupInput(raw)
  enforceRateLimit(`owner-signup-email:${input.email}`, 4, 15 * 60_000)
  return input
}

export function parseOwnerSignupConfirmationInput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpError(400, 'OWNER_SIGNUP_CONFIRM_INVALID', 'Проверьте ссылку подтверждения.')
  }
  const fields = raw as Record<string, unknown>
  if (!Object.prototype.hasOwnProperty.call(fields, 'token') ||
      typeof fields.token !== 'string' ||
      Object.keys(fields).some(key => key !== 'token')) {
    throw new HttpError(400, 'OWNER_SIGNUP_CONFIRM_INVALID', 'Проверьте ссылку подтверждения.')
  }
  return fields.token
}
