-- PIVNIK RED COSMOS v2.0
-- Additive migration only: preserves users, wallets, ledger, grants and old shop rows.

-- Achievement progress/state cache. reward_grants remains the immutable financial
-- and earned-achievement ledger; this table stores current progress for UI/admin.
CREATE TABLE IF NOT EXISTS user_achievements_v2 (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_code TEXT NOT NULL,
  is_granted BOOLEAN NOT NULL DEFAULT FALSE,
  granted_at TIMESTAMPTZ,
  current_progress BIGINT NOT NULL DEFAULT 0 CHECK (current_progress >= 0),
  required_progress BIGINT NOT NULL CHECK (required_progress > 0),
  last_progress_check_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_unlock_notification_sent_at TIMESTAMPTZ,
  UNIQUE (user_id, achievement_code)
);
CREATE INDEX IF NOT EXISTS idx_user_achievements_v2_granted
  ON user_achievements_v2(is_granted, granted_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_achievements_v2_code
  ON user_achievements_v2(achievement_code, user_id);

-- Permanent frame ownership is separate from the currently selected frame.
CREATE TABLE IF NOT EXISTS user_frames (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  frame_id TEXT NOT NULL,
  acquired_source TEXT NOT NULL DEFAULT 'legacy',
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  purchase_transaction_id BIGINT REFERENCES transactions(id) ON DELETE SET NULL,
  restored_from_legacy BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (user_id, frame_id)
);
CREATE INDEX IF NOT EXISTS idx_user_frames_user
  ON user_frames(user_id, acquired_at DESC);

CREATE TABLE IF NOT EXISTS frame_restoration_log (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  frame_id TEXT NOT NULL,
  restored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  from_source TEXT NOT NULL,
  UNIQUE (user_id, frame_id, from_source)
);

-- Preserve every currently selected legacy frame as an owned entitlement.
INSERT INTO user_frames (user_id, frame_id, acquired_source, acquired_at, restored_from_legacy)
SELECT id, profile_frame, 'legacy-selected-frame', COALESCE(updated_at, created_at), TRUE
FROM users
WHERE merged_into_user_id IS NULL
  AND deleted_at IS NULL
  AND profile_frame IS NOT NULL
  AND profile_frame <> 'none'
ON CONFLICT (user_id, frame_id) DO NOTHING;

-- Preserve old diamond entitlements stored in beta_grants.
INSERT INTO user_frames (user_id, frame_id, acquired_source, acquired_at, restored_from_legacy)
SELECT bg.user_id, 'diamond', 'legacy-beta-grant', bg.created_at, TRUE
FROM beta_grants bg
JOIN users u ON u.id = bg.user_id
WHERE bg.code = 'profile-frame-diamond'
  AND u.merged_into_user_id IS NULL
  AND u.deleted_at IS NULL
ON CONFLICT (user_id, frame_id) DO NOTHING;

INSERT INTO frame_restoration_log (user_id, frame_id, from_source)
SELECT user_id, frame_id, acquired_source
FROM user_frames
WHERE restored_from_legacy = TRUE
ON CONFLICT (user_id, frame_id, from_source) DO NOTHING;

-- Shop rows remain for audit/admin but can be hidden and made non-purchasable.
ALTER TABLE shop_items
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_purchasable BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS shop_purchases (
  id BIGSERIAL PRIMARY KEY,
  request_key TEXT NOT NULL UNIQUE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_code TEXT NOT NULL,
  bonus_price BIGINT NOT NULL DEFAULT 0 CHECK (bonus_price >= 0),
  transaction_id BIGINT NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shop_purchases_user
  ON shop_purchases(user_id, created_at DESC);

-- Special grant audit: lifetime-idempotent per user and achievement. A redeploy,
-- rollback or repeated repair command must never award the same 750 B twice.
CREATE TABLE IF NOT EXISTS special_achievement_grants (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_code TEXT NOT NULL,
  bonus_amount BIGINT NOT NULL DEFAULT 0 CHECK (bonus_amount >= 0),
  transaction_id BIGINT REFERENCES transactions(id) ON DELETE RESTRICT,
  deployment_hash TEXT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, achievement_code)
);

-- The wheel was originally Telegram-only at schema level. RED COSMOS v2 uses
-- the same table and the same prize logic for both platforms.
ALTER TABLE wheel_spins DROP CONSTRAINT IF EXISTS wheel_spins_platform_check;
ALTER TABLE wheel_spins
  ADD CONSTRAINT wheel_spins_platform_check
  CHECK (platform IN ('telegram', 'vk'));
CREATE INDEX IF NOT EXISTS idx_wheel_spins_platform_created
  ON wheel_spins(platform, created_at DESC);
