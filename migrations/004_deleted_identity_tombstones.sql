-- Preserve only keyed identity hashes after account deletion.
-- This prevents repeated welcome/beta rewards without retaining raw platform IDs.

CREATE TABLE IF NOT EXISTS deleted_identity_tombstones (
  provider TEXT NOT NULL CHECK (provider IN ('telegram', 'vk')),
  identity_hash TEXT NOT NULL CHECK (length(identity_hash) = 64),
  deleted_user_id BIGINT,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, identity_hash)
);

CREATE INDEX IF NOT EXISTS idx_deleted_identity_tombstones_deleted_at
  ON deleted_identity_tombstones(deleted_at DESC);
