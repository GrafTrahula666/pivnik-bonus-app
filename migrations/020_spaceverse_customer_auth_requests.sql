-- Manual/additive tenant-local auth receipts. Apply only in the dedicated
-- tenant DB after 017/018/019. No legacy table alteration, DML or backfill.
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_spaceverse_customer_ownership_exact_scope
  ON spaceverse_customer_ownership(user_id,runtime_key,company_id,venue_id);

CREATE TABLE IF NOT EXISTS spaceverse_customer_auth_requests (
  runtime_key TEXT NOT NULL,
  request_key UUID NOT NULL,
  company_id TEXT NOT NULL,
  venue_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('telegram','vk')),
  provider_user_id TEXT NOT NULL CHECK (provider_user_id ~ '^[1-9][0-9]{0,18}$'),
  fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  user_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(runtime_key,request_key),
  FOREIGN KEY(user_id,runtime_key,company_id,venue_id)
    REFERENCES spaceverse_customer_ownership(user_id,runtime_key,company_id,venue_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

COMMIT;
