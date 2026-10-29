-- Optional canonical scope reservation for an onboarding draft. Apply only
-- after 004 and 005, and only to an isolated metadata database first.
-- Rows created by the API remain inactive: this migration does not publish a
-- venue, grant staff access, provision a runtime or touch customer data.
BEGIN;

CREATE TABLE IF NOT EXISTS admin_onboarding_scopes (
  draft_id UUID PRIMARY KEY REFERENCES admin_onboarding_drafts(id) ON DELETE RESTRICT,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  venue_id BIGINT NOT NULL UNIQUE REFERENCES venues(id) ON DELETE RESTRICT,
  company_created_by_onboarding BOOLEAN NOT NULL,
  draft_revision INTEGER NOT NULL CHECK (draft_revision > 0),
  application_revision INTEGER NOT NULL CHECK (application_revision > 0),
  status TEXT NOT NULL DEFAULT 'prepared' CHECK (status = 'prepared'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision = 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_onboarding_scope_company
  ON admin_onboarding_scopes(company_id, venue_id);

COMMIT;
