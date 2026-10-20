-- Optional encrypted provider configuration for a prepared onboarding scope.
-- Apply manually after 004-006. The encryption key remains outside PostgreSQL;
-- this table never stores plaintext credentials and provisions no provider/POS resource.
BEGIN;

CREATE TABLE IF NOT EXISTS admin_onboarding_integrations (
  draft_id UUID NOT NULL REFERENCES admin_onboarding_scopes(draft_id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider = 'evotor'),
  store_id TEXT NOT NULL CHECK (length(store_id) BETWEEN 1 AND 200 AND store_id = btrim(store_id)),
  secret_key_id TEXT NOT NULL CHECK (secret_key_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  secret_nonce BYTEA NOT NULL CHECK (octet_length(secret_nonce) = 12),
  secret_ciphertext BYTEA NOT NULL CHECK (octet_length(secret_ciphertext) BETWEEN 1 AND 8192),
  secret_auth_tag BYTEA NOT NULL CHECK (octet_length(secret_auth_tag) = 16),
  last_request_key UUID NOT NULL,
  last_request_hash TEXT NOT NULL CHECK (last_request_hash ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'configured'
    CHECK (status IN ('configured', 'verified', 'action_required', 'error')),
  last_error_code TEXT CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_]{1,64}$'),
  last_checked_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (draft_id, provider),
  CHECK (
    (status = 'configured' AND last_checked_at IS NULL AND last_error_code IS NULL AND verified_at IS NULL)
    OR (status = 'verified' AND last_checked_at IS NOT NULL AND last_error_code IS NULL AND verified_at IS NOT NULL)
    OR (status IN ('action_required', 'error') AND last_checked_at IS NOT NULL AND last_error_code IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_admin_onboarding_integrations_status
  ON admin_onboarding_integrations(provider, status, updated_at DESC);

COMMIT;
