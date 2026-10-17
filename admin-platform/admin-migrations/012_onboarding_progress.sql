-- Manual/additive operator progress only; no runtime/device provisioning.
BEGIN;
CREATE TABLE IF NOT EXISTS admin_onboarding_progress (
  draft_id UUID PRIMARY KEY REFERENCES admin_onboarding_drafts(id) ON DELETE RESTRICT,
  current_step TEXT NOT NULL CHECK(current_step IN
    ('organization','venue','application','provider','terminal','modules','provisioning','verification')),
  terminal_id TEXT NOT NULL DEFAULT '',
  terminal_label TEXT NOT NULL DEFAULT '',
  cash_reports BOOLEAN NOT NULL DEFAULT FALSE,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMIT;
