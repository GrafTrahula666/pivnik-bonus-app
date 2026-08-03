-- Public-launch requirements: explicit 18+ confirmation, durable API limits
-- and a non-personal audit record for irreversible account deletion.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS adult_confirmed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS api_rate_limits (
  subject_hash TEXT NOT NULL,
  route_group TEXT NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (subject_hash, route_group)
);

CREATE INDEX IF NOT EXISTS idx_api_rate_limits_expiry
  ON api_rate_limits(expires_at);

CREATE TABLE IF NOT EXISTS account_deletion_audit (
  deletion_id UUID PRIMARY KEY,
  requested_from TEXT NOT NULL CHECK (requested_from IN ('telegram', 'vk', 'unknown')),
  linked_identity_count SMALLINT NOT NULL DEFAULT 0 CHECK (linked_identity_count >= 0),
  deleted_user_rows INTEGER NOT NULL DEFAULT 0 CHECK (deleted_user_rows >= 0),
  deleted_transaction_rows INTEGER NOT NULL DEFAULT 0 CHECK (deleted_transaction_rows >= 0),
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
