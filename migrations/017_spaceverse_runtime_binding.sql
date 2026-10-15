-- Manual, additive preparation for a dedicated SPACEVERSE tenant database.
-- This migration is intentionally NOT part of automatic startup. It creates no
-- tenant, customer, wallet, transaction or provider data and inserts no binding.

BEGIN;

CREATE TABLE IF NOT EXISTS spaceverse_runtime_binding (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton = TRUE),
  runtime_key TEXT NOT NULL UNIQUE
    CHECK (runtime_key ~ '^sv-[0-9a-f]{32}$'),
  manifest_sha256 TEXT NOT NULL
    CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_revision INTEGER NOT NULL CHECK (manifest_revision > 0),
  isolation_policy TEXT NOT NULL DEFAULT 'dedicated_database'
    CHECK (isolation_policy = 'dedicated_database'),
  status TEXT NOT NULL DEFAULT 'prepared'
    CHECK (status = 'prepared'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
