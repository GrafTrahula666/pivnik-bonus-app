-- SPACEVERSE tenant/location attribution foundation.
--
-- IMPORTANT: this migration is intentionally NOT wired into production startup.
-- It is additive only, performs no backfill, and leaves all historical rows
-- unattributed until a trustworthy source-of-truth mapping is approved.
--
-- The nullable columns are required so legacy transactions remain valid and so
-- we never guess which tenant/location owns an existing production row.

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS tenant_id TEXT,
  ADD COLUMN IF NOT EXISTS location_id TEXT;

COMMENT ON COLUMN transactions.tenant_id IS
  'SPACEVERSE tenant attribution. NULL means attribution is unknown/unapproved; never infer or backfill without an authoritative mapping.';

COMMENT ON COLUMN transactions.location_id IS
  'SPACEVERSE location attribution within tenant. NULL means unknown/not applicable; never infer or backfill without an authoritative mapping.';
