-- Manual, additive foundation for tenant-local customer/wallet ownership in a
-- dedicated SPACEVERSE tenant database. This migration is intentionally NOT
-- part of automatic startup (see migration-startup-policy.js, which allows
-- migrations by an explicit list, so a new file is excluded by default).
--
-- This table is deliberately separate from PIVNIK's historical `users` and
-- `wallets` tables: there is no approved mapping from those rows to a
-- SPACEVERSE tenant/venue, and this migration performs no backfill and reads
-- no historical data. A tenant customer/wallet exists only once explicitly
-- created through a reviewed SPACEVERSE flow, in a database already bound by
-- migrations 017/018 (spaceverse_runtime_binding).

BEGIN;

CREATE TABLE IF NOT EXISTS spaceverse_tenant_customers (
  id BIGSERIAL PRIMARY KEY,
  company_id TEXT NOT NULL CHECK (company_id ~ '^[1-9][0-9]{0,18}$'),
  venue_id TEXT NOT NULL CHECK (venue_id ~ '^[1-9][0-9]{0,18}$'),
  external_ref TEXT NOT NULL,
  wallet_balance BIGINT NOT NULL DEFAULT 0 CHECK (wallet_balance >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, venue_id, external_ref)
);

CREATE INDEX IF NOT EXISTS spaceverse_tenant_customers_scope_idx
  ON spaceverse_tenant_customers (company_id, venue_id);

COMMIT;
