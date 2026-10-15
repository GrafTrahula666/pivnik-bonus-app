-- Manual, additive ownership proof for customers in a dedicated SPACEVERSE
-- tenant database. Apply only after the base users/wallets schema and runtime
-- binding migrations 017/018. This migration intentionally performs no
-- backfill: an existing user or wallet is invisible to tenant reads until a
-- future reviewed flow inserts an exact ownership row.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_spaceverse_runtime_binding_scope_key
  ON spaceverse_runtime_binding(runtime_key, company_id, venue_id);

CREATE TABLE IF NOT EXISTS spaceverse_customer_ownership (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  runtime_key TEXT NOT NULL,
  company_id TEXT NOT NULL
    CHECK (company_id ~ '^[1-9][0-9]{0,18}$'),
  venue_id TEXT NOT NULL
    CHECK (venue_id ~ '^[1-9][0-9]{0,18}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT spaceverse_customer_ownership_binding_fkey
    FOREIGN KEY (runtime_key, company_id, venue_id)
    REFERENCES spaceverse_runtime_binding(runtime_key, company_id, venue_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_spaceverse_customer_ownership_scope
  ON spaceverse_customer_ownership(runtime_key, company_id, venue_id, user_id);

COMMIT;
