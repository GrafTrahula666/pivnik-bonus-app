-- Resumable provisioning ledger for the standard onboarding application.
-- Apply manually to an isolated Admin metadata database after migrations 004-006.
-- This migration creates no runtime, database, binding or external resource.
BEGIN;

CREATE TABLE IF NOT EXISTS admin_onboarding_provisioning_steps (
  draft_id UUID NOT NULL REFERENCES admin_onboarding_drafts(id) ON DELETE RESTRICT,
  step TEXT NOT NULL
    CHECK (step = 'runtime_database_binding'),
  runtime_key TEXT NOT NULL
    CHECK (runtime_key ~ '^sv-[0-9a-f]{32}$'),
  manifest_sha256 TEXT NOT NULL
    CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  application_revision INTEGER NOT NULL CHECK (application_revision > 0),
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  venue_id BIGINT NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
  status TEXT NOT NULL
    CHECK (status IN ('running','retryable_error','action_required','succeeded')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  last_error_code TEXT
    CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  result JSONB
    CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (draft_id, step),
  UNIQUE (venue_id, step),
  CHECK (
    (status = 'running' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR
    (status <> 'running' AND lease_token IS NULL AND lease_expires_at IS NULL)
  ),
  CHECK (
    (status = 'succeeded' AND result IS NOT NULL AND last_error_code IS NULL)
    OR
    (status <> 'succeeded' AND result IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_admin_onboarding_provisioning_status
  ON admin_onboarding_provisioning_steps(status, lease_expires_at, updated_at);

COMMIT;
