-- Manual additive Admin migration. Not run automatically at startup.
-- One-time SPACEVERSE-signed claims are NOT evidence of Evotor store ownership.
BEGIN;
CREATE TABLE IF NOT EXISTS admin_evotor_owner_proof_nonces (
  purpose TEXT NOT NULL CHECK (purpose = 'spaceverse.evotor.store-owner-binding.v1'),
  signing_key_id TEXT NOT NULL CHECK (signing_key_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  nonce_hash BYTEA NOT NULL CHECK (octet_length(nonce_hash) = 32),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (purpose, signing_key_id, nonce_hash)
);
CREATE INDEX IF NOT EXISTS admin_evotor_owner_proof_nonces_expires_idx
  ON admin_evotor_owner_proof_nonces(expires_at);
COMMIT;
