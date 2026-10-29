-- Manual, additive metadata only. Never applied by application startup.
BEGIN;
CREATE TABLE IF NOT EXISTS admin_onboarding_support_requests (
  id UUID PRIMARY KEY,
  draft_id UUID NOT NULL REFERENCES admin_onboarding_drafts(id) ON DELETE RESTRICT,
  created_by_admin_id BIGINT NOT NULL REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  topic TEXT NOT NULL CHECK(topic IN ('connection','customer_data','access','activation')),
  status TEXT NOT NULL DEFAULT 'recorded' CHECK(status='recorded'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(draft_id,topic)
);
CREATE INDEX IF NOT EXISTS idx_onboarding_support_created
  ON admin_onboarding_support_requests(created_at DESC,id);
COMMIT;
