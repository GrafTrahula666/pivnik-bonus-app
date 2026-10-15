-- Manual, additive launch permissions in an already bound dedicated database.
-- No permission, tenant, customer, wallet, device or service is created here.
BEGIN;

CREATE TABLE IF NOT EXISTS spaceverse_runtime_launch_authorizations (
  id UUID PRIMARY KEY,
  runtime_key TEXT NOT NULL REFERENCES spaceverse_runtime_binding(runtime_key) ON DELETE RESTRICT,
  manifest_sha256 TEXT NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  bundle_sha256 TEXT NOT NULL CHECK (bundle_sha256 ~ '^[0-9a-f]{64}$'),
  image_id TEXT NOT NULL CHECK (image_id ~ '^sha256:[0-9a-f]{64}$'),
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  state TEXT NOT NULL DEFAULT 'authorized' CHECK (state IN ('authorized','suspended','revoked')),
  authorized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  CHECK (expires_at > authorized_at AND expires_at <= authorized_at + INTERVAL '24 hours'),
  CHECK ((state = 'revoked') = (revoked_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_spaceverse_launch_scope
  ON spaceverse_runtime_launch_authorizations(runtime_key, manifest_sha256, expires_at);

COMMIT;
