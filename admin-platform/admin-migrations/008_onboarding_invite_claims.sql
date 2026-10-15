-- Lets a pending invite link (007) be redeemed exactly once into a real,
-- brand-new VENUE_ADMIN account with owner access to the prepared company.
-- Additive only: existing accounts, access grants and invites are untouched.
BEGIN;

ALTER TABLE admin_onboarding_invites
  ADD COLUMN IF NOT EXISTS claimed_admin_id BIGINT REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

ALTER TABLE admin_onboarding_invites DROP CONSTRAINT IF EXISTS admin_onboarding_invites_status_check;
ALTER TABLE admin_onboarding_invites
  ADD CONSTRAINT admin_onboarding_invites_status_check CHECK (status IN ('pending', 'revoked', 'claimed'));

COMMIT;
