/**
 * SPACEVERSE marketing opt-in decision (CHAT 13 / 121).
 *
 * Unmounted, side-effect-free prerequisite for the future tenant-scoped consent
 * journal. This module never reads a user-supplied consent assertion. Callers
 * MUST read latestEvent from an authenticated, tenant-scoped server-side store,
 * ordered by its monotonic committed event sequence, and must recheck it
 * immediately before each provider send. No legacy marketing_opt_in fallback.
 *
 * This module does not provide the journal, routes, migrations or delivery.
 */
export const MARKETING_CHANNELS = Object.freeze(['telegram', 'vk']);

const deny = (reason) => Object.freeze({ allowed: false, reason });
const ALLOWED_SURFACES = Object.freeze({
  telegram: 'telegram_mini_app',
  vk: 'vk_mini_app'
});

function scopedId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 128
    && value.trim() === value
    && /^[a-zA-Z0-9:_-]+$/.test(value);
}

function auditId(value) {
  return typeof value === 'string' && value.length > 0
    && value.length <= 128 && value.trim() === value
    && /^[a-zA-Z0-9:_-]+$/.test(value);
}

function approvedTextHash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

/**
 * Evaluate the *latest persisted* record for exactly one channel/purpose/scope.
 * Input values are trusted server-derived context, never browser-provided scope.
 * consentTextSha256 is a server-approved digest of the complete displayed text.
 * A `null`/missing/invalid/unknown record always denies.
 */
export function evaluateMarketingConsent({
  tenantId,
  customerId,
  channel,
  providerIdentityId,
  consentTextVersion,
  consentTextSha256,
  latestEvent
} = {}) {
  if (!scopedId(tenantId) || !scopedId(customerId)) return deny('scope_invalid');
  if (!Object.hasOwn(ALLOWED_SURFACES, channel)) return deny('channel_invalid');
  if (!scopedId(providerIdentityId)) return deny('identity_unverified');
  if (!auditId(consentTextVersion) || !approvedTextHash(consentTextSha256)) return deny('consent_text_unconfigured');
  if (latestEvent == null) return deny('consent_absent');
  if (typeof latestEvent !== 'object' || Array.isArray(latestEvent)) return deny('evidence_invalid');

  if (latestEvent.tenantId !== tenantId
    || latestEvent.customerId !== customerId
    || latestEvent.channel !== channel
    || latestEvent.purpose !== 'marketing') return deny('evidence_scope_mismatch');

  // The durable writer must record immutable IDs, a server timestamp and an
  // authenticated actor for every event. A browser timestamp is not evidence.
  if (!auditId(latestEvent.eventId)
    || !auditId(latestEvent.authenticatedActorId)
    || !auditId(latestEvent.requestId)
    || !auditId(latestEvent.idempotencyKey)
    || typeof latestEvent.serverRecordedAt !== 'string'
    || !Number.isFinite(Date.parse(latestEvent.serverRecordedAt))) {
    return deny('evidence_invalid');
  }

  if (latestEvent.action === 'revoke') return deny('consent_revoked');
  if (latestEvent.action !== 'grant') return deny('evidence_invalid');

  if (latestEvent.authenticatedActorId !== customerId
    || latestEvent.sourceSurface !== ALLOWED_SURFACES[channel]
    || latestEvent.explicitOptIn !== true) return deny('consent_not_proven');
  if (latestEvent.providerIdentityId !== providerIdentityId) return deny('identity_changed');
  if (latestEvent.consentTextVersion !== consentTextVersion
    || latestEvent.consentTextSha256 !== consentTextSha256) return deny('consent_text_outdated');

  return Object.freeze({ allowed: true, reason: 'consent_proven' });
}
