-- Real, ledger-backed achievements shared by Telegram and VK.

ALTER TABLE reward_grants
  ADD COLUMN IF NOT EXISTS achievement_code TEXT,
  ADD COLUMN IF NOT EXISTS achievement_period TEXT,
  ADD COLUMN IF NOT EXISTS reward_beer_ml BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS announced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_reward_grants_achievements
  ON reward_grants(user_id, achievement_code, created_at DESC)
  WHERE source = 'achievement' AND achievement_code IS NOT NULL;

ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_mode_check;

ALTER TABLE transactions
  ADD CONSTRAINT transactions_mode_check
  CHECK (mode IN (
    'accrue', 'redeem', 'adjustment', 'beer_gift',
    'welcome', 'shop', 'achievement'
  ));
