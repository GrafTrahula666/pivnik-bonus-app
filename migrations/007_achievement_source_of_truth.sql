-- One durable achievement ledger for catalog, profile and notifications.

CREATE TABLE IF NOT EXISTS achievement_award_batches (
  code TEXT PRIMARY KEY,
  expected_recipients INTEGER NOT NULL CHECK (expected_recipients > 0),
  reward_per_user BIGINT NOT NULL CHECK (reward_per_user >= 0),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Preserve users who already received the legacy closed-beta reward. The old
-- bonus has already been paid, so this backfill only materializes the earned
-- achievement and marks the historical notification as acknowledged.
INSERT INTO reward_grants (
  code, user_id, amount, source, achievement_code,
  achievement_period, reward_beer_ml, announced_at, created_at
)
SELECT
  'achievement:beta-tester',
  bg.user_id,
  bg.amount,
  'achievement',
  'beta-tester',
  NULL,
  0,
  bg.created_at,
  bg.created_at
FROM beta_grants bg
JOIN users u ON u.id = bg.user_id
WHERE bg.code = 'beta-tester-legendary'
  AND u.merged_into_user_id IS NULL
  AND u.deleted_at IS NULL
ON CONFLICT (code, user_id) DO NOTHING;

-- A user can have one durable grant per non-recurring achievement and one per
-- recurring period. This prevents a second API implementation from inventing
-- another grant code for the same achievement.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reward_grants_achievement_identity
  ON reward_grants (
    user_id,
    achievement_code,
    COALESCE(achievement_period, '')
  )
  WHERE source = 'achievement' AND achievement_code IS NOT NULL;
