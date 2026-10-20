-- Manual, additive idempotency ledger for creating NEW customers in a
-- dedicated SPACEVERSE tenant database. Apply only after migrations 017-019
-- and the base users/user_identities/wallets schema. This migration performs
-- no backfill and does not adopt any historical provider identity.

BEGIN;

CREATE TABLE IF NOT EXISTS spaceverse_customer_create_requests (
  runtime_key TEXT NOT NULL,
  request_key UUID NOT NULL,
  request_fingerprint TEXT NOT NULL
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  company_id TEXT NOT NULL
    CHECK (company_id ~ '^[1-9][0-9]{0,18}$'),
  venue_id TEXT NOT NULL
    CHECK (venue_id ~ '^[1-9][0-9]{0,18}$'),
  user_id BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (runtime_key, request_key),
  UNIQUE (user_id),
  CONSTRAINT spaceverse_customer_create_request_binding_fkey
    FOREIGN KEY (runtime_key, company_id, venue_id)
    REFERENCES spaceverse_runtime_binding(runtime_key, company_id, venue_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT spaceverse_customer_create_request_completion_check
    CHECK ((user_id IS NULL) = (completed_at IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_spaceverse_customer_create_requests_scope
  ON spaceverse_customer_create_requests(
    runtime_key, company_id, venue_id, created_at DESC
  );

COMMIT;
