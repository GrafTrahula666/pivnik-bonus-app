-- One-time invite link for the owner of a prepared onboarding scope. This
-- table only tracks the link artifact itself (hashed token, expiry,
-- revocation, audit trail). It does not create or grant any admin account or
-- company access: redeeming the link into real owner access is a separate,
-- explicitly authorized step.
BEGIN;

CREATE TABLE IF NOT EXISTS admin_onboarding_invites (
  id UUID PRIMARY KEY,
  draft_id UUID NOT NULL REFERENCES admin_onboarding_drafts(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  created_by_admin_id BIGINT NOT NULL REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'revoked')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_admin_onboarding_invites_draft
  ON admin_onboarding_invites(draft_id, created_at DESC);

COMMIT;
