-- Preserve only platform identity keys after account deletion.
-- This prevents repeated welcome/beta rewards without restoring deleted profiles.

CREATE TABLE IF NOT EXISTS deleted_identity_tombstones (
  provider TEXT NOT NULL CHECK (provider IN ('telegram', 'vk')),
  provider_user_id TEXT NOT NULL,
  deleted_user_id BIGINT,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_deleted_identity_tombstones_deleted_at
  ON deleted_identity_tombstones(deleted_at DESC);
