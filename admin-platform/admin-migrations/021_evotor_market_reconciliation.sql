-- Manual Admin metadata migration, applied after 020. No startup execution.
-- Conflicting authenticated callbacks must survive the 409 response. These
-- sticky holds have no automatic reset; a future reconciler needs separate review.
BEGIN;
ALTER TABLE admin_evotor_market_users
  ADD COLUMN IF NOT EXISTS reconciliation_required BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE admin_evotor_market_subscriptions
  ADD COLUMN IF NOT EXISTS reconciliation_required BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS admin_evotor_market_conflicts (
  event_key TEXT NOT NULL REFERENCES admin_evotor_market_events(event_key),
  observed_sha256 TEXT NOT NULL CHECK(observed_sha256 ~ '^[0-9a-f]{64}$'),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(event_key,observed_sha256)
);
COMMIT;
