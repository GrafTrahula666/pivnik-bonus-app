-- Optional onboarding metadata only. Apply manually to an isolated DB first.
-- No customer, company, venue, wallet or provider resources are provisioned here.
BEGIN;

CREATE TABLE IF NOT EXISTS admin_onboarding_drafts (
  id UUID PRIMARY KEY,
  admin_id BIGINT NOT NULL REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  company_id BIGINT REFERENCES companies(id) ON DELETE RESTRICT,
  request_key UUID NOT NULL,
  initial_hash TEXT NOT NULL CHECK (length(initial_hash) = 64),
  data JSONB NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status = 'draft'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (admin_id, request_key)
);
CREATE INDEX IF NOT EXISTS idx_admin_onboarding_owner_updated
  ON admin_onboarding_drafts(admin_id, updated_at DESC, id);

COMMIT;
