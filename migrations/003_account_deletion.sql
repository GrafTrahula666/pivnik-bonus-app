-- Irreversible account deletion keeps anonymous financial rows for audit,
-- while removing the user's identity, profile, rewards, QR access and balance.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_active_accounts
  ON users(id)
  WHERE merged_into_user_id IS NULL AND deleted_at IS NULL;
