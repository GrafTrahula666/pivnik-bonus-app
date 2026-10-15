-- Manual/additive Business metadata. No PIVNIK customer/wallet changes.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS idx_venues_canonical_company ON venues(id,company_id);

-- Extend the existing 007/008 invitation artifact. Legacy rows are retained;
-- no backfill, duplicate invitation table or changes to PIVNIK data.
ALTER TABLE admin_onboarding_invites ALTER COLUMN draft_id DROP NOT NULL;
ALTER TABLE admin_onboarding_invites
  ADD COLUMN IF NOT EXISTS company_id BIGINT REFERENCES companies(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS venue_id BIGINT,
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'owner' CHECK(role IN ('owner','manager','viewer')),
  ADD COLUMN IF NOT EXISTS request_key UUID,
  ADD COLUMN IF NOT EXISTS fingerprint TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_onboarding_invite_request
  ON admin_onboarding_invites(created_by_admin_id,request_key);
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='onboarding_invite_canonical_venue') THEN
    ALTER TABLE admin_onboarding_invites ADD CONSTRAINT onboarding_invite_canonical_venue
      FOREIGN KEY(venue_id,company_id) REFERENCES venues(id,company_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='onboarding_invite_request_shape') THEN
    ALTER TABLE admin_onboarding_invites ADD CONSTRAINT onboarding_invite_request_shape CHECK(
      (request_key IS NULL AND fingerprint IS NULL) OR
      (request_key IS NOT NULL AND fingerprint IS NOT NULL AND fingerprint ~ '^[0-9a-f]{64}$'
        AND company_id IS NOT NULL AND (venue_id IS NULL OR draft_id IS NOT NULL)));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS admin_onboarding_access (
  invitation_id UUID PRIMARY KEY REFERENCES admin_onboarding_invites(id) ON DELETE RESTRICT,
  admin_id BIGINT NOT NULL REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  venue_id BIGINT,
  draft_id UUID REFERENCES admin_onboarding_drafts(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK(role IN ('owner','manager','viewer')),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(venue_id,company_id) REFERENCES venues(id,company_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_onboarding_access_actor ON admin_onboarding_access(admin_id,company_id,venue_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_access_draft ON admin_onboarding_access(draft_id,admin_id);
COMMIT;
