-- Manual, additive resource reservations. No database/tenant/customer is created.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS idx_onboarding_app_runtime_draft
  ON admin_onboarding_app_configs(draft_id,tenant_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_onboarding_scope_exact_draft
  ON admin_onboarding_scopes(draft_id,company_id,venue_id);
CREATE TABLE IF NOT EXISTS admin_onboarding_database_allocations (
  draft_id UUID PRIMARY KEY,
  runtime_key TEXT NOT NULL UNIQUE CHECK (runtime_key ~ '^sv-[0-9a-f]{32}$'),
  slot_key TEXT NOT NULL UNIQUE CHECK (slot_key ~ '^capacity-[a-z0-9-]{1,48}$'),
  target_fingerprint TEXT NOT NULL UNIQUE CHECK (target_fingerprint ~ '^[0-9a-f]{64}$'),
  manifest_sha256 TEXT NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  application_revision INTEGER NOT NULL CHECK (application_revision>0),
  company_id BIGINT NOT NULL,
  venue_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (draft_id,runtime_key) REFERENCES admin_onboarding_app_configs(draft_id,tenant_key) ON DELETE RESTRICT,
  FOREIGN KEY (draft_id,company_id,venue_id) REFERENCES admin_onboarding_scopes(draft_id,company_id,venue_id) ON DELETE RESTRICT
);
COMMIT;
