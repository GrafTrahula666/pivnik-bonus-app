-- Manual/additive metadata for the existing canonical onboarding scope.
BEGIN;
CREATE TABLE IF NOT EXISTS admin_onboarding_pos_proxy (
  draft_id UUID PRIMARY KEY REFERENCES admin_onboarding_drafts(id) ON DELETE RESTRICT,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  venue_id BIGINT NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
  runtime_key TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL CHECK(manifest_sha256 ~ '^[0-9a-f]{64}$'),
  store_id TEXT NOT NULL,
  terminal_id TEXT NOT NULL,
  secret_key_id TEXT NOT NULL,
  secret_nonce BYTEA NOT NULL CHECK(octet_length(secret_nonce)=12),
  secret_ciphertext BYTEA NOT NULL,
  secret_auth_tag BYTEA NOT NULL CHECK(octet_length(secret_auth_tag)=16),
  request_key UUID NOT NULL,
  request_revision INTEGER NOT NULL CHECK(request_revision>=0),
  request_fingerprint TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verifying','active','degraded','suspended','failed')),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  last_code TEXT NOT NULL DEFAULT 'not_verified',
  checked_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  last_device_event_at TIMESTAMPTZ,
  report JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK((lease_token IS NULL)=(lease_expires_at IS NULL))
);
COMMIT;
