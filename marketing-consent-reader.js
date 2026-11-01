import { requireSpaceverseTenantRuntime } from './spaceverse-runtime-manifest.js';
import { evaluateMarketingConsent, MARKETING_CHANNELS } from './marketing-consent-policy.js';

const CANONICAL_BIGINT = /^[1-9][0-9]{0,18}$/;
const MAX_SIGNED_BIGINT = 9223372036854775807n;
const VERSION = /^[a-zA-Z0-9:_-]{1,128}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const denied = reason => Object.freeze({ allowed: false, reason });

function canonicalId(value) {
  if (typeof value !== 'string' || !CANONICAL_BIGINT.test(value)
    || BigInt(value) > MAX_SIGNED_BIGINT) throw new TypeError('Canonical customer/provider identifier required');
  return value;
}

/**
 * Database and runtime binding MUST be dedicated to the same tenant. Read the
 * head pointer, not MAX(timestamp) or MAX(sequence); neither is commit order.
 * The user and the active provider identity are verified in the SAME query.
 * This is a read-only, unmounted prerequisite, not a send authorization lease.
 */
export const SPACEVERSE_MARKETING_CONSENT_READ_SQL = `WITH verified_binding AS (
  SELECT runtime_key,company_id,venue_id
  FROM spaceverse_runtime_binding
  WHERE singleton=TRUE AND runtime_key=$1 AND manifest_sha256=$2
    AND manifest_revision=$3 AND company_id=$4 AND venue_id=$5
    AND isolation_policy='dedicated_database' AND status='prepared'
), owned_identity AS (
  SELECT u.id AS user_id, i.id AS identity_id, b.runtime_key,b.company_id,b.venue_id
  FROM verified_binding b
  JOIN spaceverse_customer_ownership o
    ON o.runtime_key=b.runtime_key AND o.company_id=b.company_id AND o.venue_id=b.venue_id
  JOIN users u ON u.id=o.user_id AND u.role='client'
    AND u.deleted_at IS NULL AND u.merged_into_user_id IS NULL
  JOIN user_identities i ON i.user_id=u.id AND i.provider=$7 AND i.provider_user_id=$8
  WHERE o.user_id=$6::bigint
)
SELECT o.user_id::text AS user_id, o.identity_id::text AS identity_id,
  e.event_id::text AS event_id, e.user_id::text AS event_user_id,
  e.runtime_key AS event_runtime_key, e.company_id AS event_company_id,
  e.venue_id AS event_venue_id, e.channel AS event_channel,
  e.purpose AS event_purpose, e.action AS event_action,
  e.provider_identity_id AS event_provider_identity_id,
  e.consent_text_version AS event_consent_text_version,
  e.consent_text_sha256 AS event_consent_text_sha256,
  e.source_surface AS event_source_surface,
  e.authenticated_actor_user_id::text AS event_actor_user_id,
  e.explicit_opt_in AS event_explicit_opt_in,
  e.request_id AS event_request_id, e.idempotency_key AS event_idempotency_key,
  e.server_recorded_at::text AS event_server_recorded_at
FROM owned_identity o
LEFT JOIN spaceverse_marketing_consent_heads h
  ON h.user_id=o.user_id AND h.runtime_key=o.runtime_key
  AND h.company_id=o.company_id AND h.venue_id=o.venue_id
  AND h.channel=$7 AND h.purpose='marketing'
LEFT JOIN spaceverse_marketing_consent_events e
  ON e.event_id=h.latest_event_id AND e.user_id=h.user_id
  AND e.runtime_key=h.runtime_key AND e.company_id=h.company_id
  AND e.venue_id=h.venue_id AND e.channel=h.channel AND e.purpose=h.purpose
LIMIT 2`;

/**
 * Caller must supply only IDs from authenticated backend session/identity.
 * Consent copy is trusted factory configuration, never request data.
 * No legacy marketing flags, fallback tenants, writes or provider calls.
 */
export function createSpaceverseMarketingConsentReader({ runtime, query, approvedCopies } = {}) {
  const verified = requireSpaceverseTenantRuntime(runtime);
  if (typeof query !== 'function') throw new TypeError('query required');
  if (!approvedCopies || typeof approvedCopies !== 'object' || Array.isArray(approvedCopies)) {
    throw new TypeError('Approved channel copies required');
  }
  const copies = {};
  for (const channel of MARKETING_CHANNELS) {
    const copy = approvedCopies[channel];
    if (!copy || !VERSION.test(copy.version) || !SHA256.test(copy.sha256)) {
      throw new TypeError(`Approved ${channel} consent copy required`);
    }
    copies[channel] = Object.freeze({ version: copy.version, sha256: copy.sha256 });
  }
  const binding = verified.binding;
  const scope = Object.freeze([
    binding.runtimeKey, binding.manifestSha256, binding.manifestRevision,
    verified.context.tenantId, verified.context.locationId
  ]);

  return async function readMarketingConsent(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)
      || Object.keys(options).some(key => !['userId', 'channel', 'providerUserId'].includes(key))) {
      throw new TypeError('Consent scope cannot be supplied by a request');
    }
    const userId = canonicalId(options.userId);
    const providerUserId = canonicalId(options.providerUserId);
    const channel = options.channel;
    if (!MARKETING_CHANNELS.includes(channel)) throw new TypeError('Unsupported consent channel');
    let result;
    try {
      result = await query(SPACEVERSE_MARKETING_CONSENT_READ_SQL,
        [...scope, userId, channel, providerUserId]);
    } catch {
      return denied('consent_unavailable');
    }
    if (!result || !Array.isArray(result.rows) || result.rows.length !== 1
      || (result.rowCount !== undefined && result.rowCount !== 1)) {
      return denied('consent_unavailable');
    }
    const row = result.rows[0];
    if (!row || row.user_id !== userId || !CANONICAL_BIGINT.test(row.identity_id ?? '')) {
      return denied('identity_unverified');
    }
    const event = row.event_id == null ? null : {
      eventId: row.event_id, tenantId: row.event_company_id, customerId: row.event_user_id,
      channel: row.event_channel, purpose: row.event_purpose, action: row.event_action,
      providerIdentityId: row.event_provider_identity_id,
      consentTextVersion: row.event_consent_text_version,
      consentTextSha256: row.event_consent_text_sha256,
      sourceSurface: row.event_source_surface,
      authenticatedActorId: row.event_actor_user_id,
      explicitOptIn: row.event_explicit_opt_in,
      requestId: row.event_request_id, idempotencyKey: row.event_idempotency_key,
      serverRecordedAt: row.event_server_recorded_at
    };
    // A trusted immutable event must remain scoped to this exact runtime/venue;
    // these checks are additional to the composite SQL FK and tenant predicate.
    if (event && (row.event_runtime_key !== binding.runtimeKey
      || row.event_venue_id !== verified.context.locationId)) {
      return denied('evidence_scope_mismatch');
    }
    return evaluateMarketingConsent({
      tenantId: verified.context.tenantId, customerId: userId, channel,
      providerIdentityId: row.identity_id,
      consentTextVersion: copies[channel].version,
      consentTextSha256: copies[channel].sha256,
      latestEvent: event
    });
  };
}
