-- Optional onboarding application blueprint. Apply only after 004.
-- This reserves a tenant key and safe, non-secret configuration; it does not
-- provision a runtime, database, bot, webhook, POS link or customer data.
BEGIN;

CREATE TABLE IF NOT EXISTS admin_onboarding_app_configs (
  draft_id UUID PRIMARY KEY REFERENCES admin_onboarding_drafts(id) ON DELETE CASCADE,
  tenant_key TEXT NOT NULL UNIQUE
    CHECK (tenant_key ~ '^[a-z][a-z0-9-]{7,47}$'),
  config JSONB NOT NULL CHECK (jsonb_typeof(config) = 'object'),
  isolation_policy TEXT NOT NULL DEFAULT 'dedicated_database'
    CHECK (isolation_policy = 'dedicated_database'),
  provisioning_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (provisioning_status = 'not_started'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
