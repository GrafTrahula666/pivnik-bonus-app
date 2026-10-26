-- Manual additive Admin migration; no startup execution or production activation.
-- OAuth state binds the callback to an authenticated SPACEVERSE owner session.
-- The random state is never stored in plaintext; it does not prove Evotor ownership.
BEGIN;
CREATE TABLE IF NOT EXISTS admin_evotor_oauth_states (
  state_hash BYTEA PRIMARY KEY CHECK (octet_length(state_hash) = 32),
  admin_id BIGINT NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL REFERENCES admin_sessions(token_hash) ON DELETE CASCADE,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  venue_id BIGINT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  product_id UUID NOT NULL,
  redirect_uri TEXT NOT NULL CHECK (length(redirect_uri) BETWEEN 12 AND 2048),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  CHECK (expires_at > issued_at)
);
CREATE INDEX IF NOT EXISTS admin_evotor_oauth_states_expiry_idx
  ON admin_evotor_oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS admin_evotor_oauth_states_session_idx
  ON admin_evotor_oauth_states(session_token_hash, expires_at);
COMMIT;
