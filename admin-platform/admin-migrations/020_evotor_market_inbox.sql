-- Manual Admin metadata migration. No startup execution or tenant activation.
BEGIN;
CREATE TABLE IF NOT EXISTS admin_evotor_market_users (
  product_id UUID NOT NULL,
  user_id TEXT NOT NULL CHECK(length(user_id) BETWEEN 1 AND 128),
  secret_key_id TEXT,
  secret_nonce BYTEA CHECK(secret_nonce IS NULL OR octet_length(secret_nonce)=12),
  secret_ciphertext BYTEA,
  secret_auth_tag BYTEA CHECK(secret_auth_tag IS NULL OR octet_length(secret_auth_tag)=16),
  token_fingerprint TEXT,
  token_revision BIGINT NOT NULL DEFAULT 0,
  installation_state TEXT NOT NULL DEFAULT 'unknown'
    CHECK(installation_state IN ('unknown','installed','uninstalled','ambiguous')),
  installation_timestamp BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(product_id,user_id),
  CHECK((secret_key_id IS NULL AND secret_nonce IS NULL AND secret_ciphertext IS NULL
    AND secret_auth_tag IS NULL AND token_fingerprint IS NULL)
    OR (secret_key_id IS NOT NULL AND secret_nonce IS NOT NULL AND secret_ciphertext IS NOT NULL
    AND secret_auth_tag IS NOT NULL AND token_fingerprint IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS admin_evotor_market_events (
  event_key TEXT PRIMARY KEY,
  product_id UUID NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('installation','subscription')),
  payload_sha256 TEXT NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(product_id,user_id) REFERENCES admin_evotor_market_users(product_id,user_id)
);
CREATE TABLE IF NOT EXISTS admin_evotor_market_subscriptions (
  subscription_id UUID PRIMARY KEY,
  product_id UUID NOT NULL,
  user_id TEXT NOT NULL,
  last_sequence BIGINT NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','active','termination_requested','terminated','review_required')),
  has_sequence_gap BOOLEAN NOT NULL DEFAULT FALSE,
  paid_until TIMESTAMPTZ,
  plan_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(product_id,user_id) REFERENCES admin_evotor_market_users(product_id,user_id)
);
CREATE INDEX IF NOT EXISTS admin_evotor_market_subscription_user_idx
  ON admin_evotor_market_subscriptions(product_id,user_id);
CREATE INDEX IF NOT EXISTS admin_evotor_market_event_sequence_idx
  ON admin_evotor_market_events(product_id,user_id,(payload->>'subscriptionId'),((payload->>'sequenceNumber')::bigint))
  WHERE kind='subscription';
COMMIT;
