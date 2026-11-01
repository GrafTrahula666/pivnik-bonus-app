-- Manual ADMIN METADATA migration only. Do not apply to production as part of CHAT 14.
-- AI is a separate paid/add-on entitlement. No rows are created or activated here.
-- CRM enablement and guest reward entitlements are deliberately independent.
BEGIN;

CREATE TABLE IF NOT EXISTS admin_ai_entitlements (
  venue_id BIGINT PRIMARY KEY REFERENCES venues(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'not_configured'
    CHECK (state IN ('not_configured', 'pending', 'active', 'suspended')),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  approved_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  approval_reference TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    NOT enabled OR (
      state = 'active'
      AND approved_at IS NOT NULL
      AND expires_at IS NOT NULL
      AND expires_at > approved_at
      AND approval_reference IS NOT NULL
      AND length(btrim(approval_reference)) BETWEEN 5 AND 256
    )
  )
);

COMMIT;
