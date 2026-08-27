-- PIVNIK RED COSMOS v2.0
-- Additive migration only: preserves users, wallets, ledger, grants and old shop rows.

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
CREATE INDEX IF NOT EXISTS idx_user_achievements_v2_granted ON user_achievements_v2(is_granted, granted_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_achievements_v2_code ON user_achievements_v2(achievement_code, user_id);

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
CREATE INDEX IF NOT EXISTS idx_user_frames_user ON user_frames(user_id, acquired_at DESC);

CREATE TABLE IF NOT EXISTS frame_restoration_log (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  frame_id TEXT NOT NULL,
  restored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  from_source TEXT NOT NULL,
  UNIQUE (user_id, frame_id, from_source)
);

INSERT INTO user_frames (user_id, frame_id, acquired_source, acquired_at, restored_from_legacy)
SELECT id, profile_frame, 'legacy-selected-frame', COALESCE(updated_at, created_at), TRUE
FROM users
WHERE merged_into_user_id IS NULL AND deleted_at IS NULL
  AND profile_frame IS NOT NULL AND profile_frame <> 'none'
ON CONFLICT (user_id, frame_id) DO NOTHING;

INSERT INTO user_frames (user_id, frame_id, acquired_source, acquired_at, restored_from_legacy)
SELECT bg.user_id, 'diamond', 'legacy-beta-grant', bg.created_at, TRUE
FROM beta_grants bg JOIN users u ON u.id = bg.user_id
WHERE bg.code = 'profile-frame-diamond'
  AND u.merged_into_user_id IS NULL AND u.deleted_at IS NULL
ON CONFLICT (user_id, frame_id) DO NOTHING;

INSERT INTO frame_restoration_log (user_id, frame_id, from_source)
SELECT user_id, frame_id, acquired_source FROM user_frames WHERE restored_from_legacy = TRUE
ON CONFLICT (user_id, frame_id, from_source) DO NOTHING;

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
CREATE INDEX IF NOT EXISTS idx_shop_purchases_user ON shop_purchases(user_id, created_at DESC);

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

-- The three tester rewards are durable entitlements even when a tester has not
-- yet recreated an account in the recovered production database. A row binds
-- to the first authenticated, exact platform identity match and can only bind once.
CREATE TABLE IF NOT EXISTS pending_special_achievement_recipients (
  handle TEXT PRIMARY KEY,
  telegram_username TEXT NOT NULL,
  vk_provider_user_id TEXT,
  achievement_code TEXT NOT NULL DEFAULT 'raise-shields',
  bonus_amount BIGINT NOT NULL DEFAULT 750 CHECK (bonus_amount >= 0),
  granted_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (handle = LOWER(handle)),
  CHECK (telegram_username = LOWER(telegram_username))
);

INSERT INTO pending_special_achievement_recipients (
  handle, telegram_username, vk_provider_user_id, achievement_code, bonus_amount
) VALUES
  ('drolted', 'drolted', '418990245', 'raise-shields', 750),
  ('distraktor', 'distraktor', NULL, 'raise-shields', 750),
  ('ksemar', 'ksemar', NULL, 'raise-shields', 750)
ON CONFLICT (handle) DO UPDATE SET
  telegram_username = EXCLUDED.telegram_username,
  vk_provider_user_id = COALESCE(pending_special_achievement_recipients.vk_provider_user_id, EXCLUDED.vk_provider_user_id),
  achievement_code = EXCLUDED.achievement_code,
  bonus_amount = EXCLUDED.bonus_amount;

-- Claim one pending tester entitlement only from an authenticated identity.
-- Existing raise-shields grants are recognized and never paid twice.
CREATE OR REPLACE FUNCTION pivnik_claim_pending_special_achievement(
  p_user_id BIGINT,
  p_provider TEXT,
  p_provider_user_id TEXT,
  p_provider_username TEXT
) RETURNS TABLE(claimed BOOLEAN, recipient_handle TEXT, awarded_bonus BIGINT)
LANGUAGE plpgsql
AS $$
DECLARE
  target pending_special_achievement_recipients%ROWTYPE;
  existing_grant RECORD;
  inserted_grant BIGINT;
  tx_id BIGINT;
  balance_after BIGINT;
  grant_code TEXT;
  normalized_username TEXT := LOWER(REGEXP_REPLACE(COALESCE(p_provider_username, ''), '^@+', ''));
BEGIN
  IF p_provider NOT IN ('telegram', 'vk') THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 0::BIGINT;
    RETURN;
  END IF;

  -- The caller must already have persisted this exact authenticated identity.
  IF NOT EXISTS (
    SELECT 1
    FROM user_identities ui
    JOIN users u ON u.id = ui.user_id
    WHERE ui.user_id = p_user_id
      AND ui.provider = p_provider
      AND ui.provider_user_id = p_provider_user_id
      AND u.merged_into_user_id IS NULL
      AND u.deleted_at IS NULL
  ) THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 0::BIGINT;
    RETURN;
  END IF;

  SELECT p.* INTO target
  FROM pending_special_achievement_recipients p
  WHERE p.granted_user_id IS NULL
    AND (
      (p_provider = 'telegram' AND normalized_username <> '' AND normalized_username = p.telegram_username)
      OR
      (p_provider = 'vk' AND p.vk_provider_user_id IS NOT NULL AND p_provider_user_id = p.vk_provider_user_id)
    )
  ORDER BY p.handle
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 0::BIGINT;
    RETURN;
  END IF;

  SELECT rg.code, rg.amount, rg.created_at INTO existing_grant
  FROM reward_grants rg
  WHERE rg.user_id = p_user_id
    AND rg.source = 'achievement'
    AND rg.achievement_code = target.achievement_code
  ORDER BY rg.created_at ASC
  LIMIT 1;

  IF FOUND THEN
    INSERT INTO special_achievement_grants (
      user_id, achievement_code, bonus_amount, transaction_id, deployment_hash, granted_at
    ) VALUES (
      p_user_id, target.achievement_code, existing_grant.amount, NULL, 'recognized-existing-grant', existing_grant.created_at
    ) ON CONFLICT (user_id, achievement_code) DO NOTHING;

    INSERT INTO user_achievements_v2 (
      user_id, achievement_code, is_granted, granted_at, current_progress, required_progress, last_progress_check_at
    ) VALUES (
      p_user_id, target.achievement_code, TRUE, existing_grant.created_at, 1, 1, NOW()
    ) ON CONFLICT (user_id, achievement_code) DO UPDATE SET
      is_granted = TRUE,
      granted_at = COALESCE(user_achievements_v2.granted_at, EXCLUDED.granted_at),
      current_progress = 1,
      required_progress = 1,
      last_progress_check_at = NOW();

    UPDATE pending_special_achievement_recipients
    SET granted_user_id = p_user_id, granted_at = COALESCE(granted_at, existing_grant.created_at)
    WHERE handle = target.handle AND granted_user_id IS NULL;

    RETURN QUERY SELECT TRUE, target.handle, 0::BIGINT;
    RETURN;
  END IF;

  grant_code := 'achievement:raise-shields-v2:' || target.handle;

  INSERT INTO reward_grants (
    code, user_id, amount, source, achievement_code, achievement_period
  ) VALUES (
    grant_code, p_user_id, target.bonus_amount, 'achievement', target.achievement_code, NULL
  ) ON CONFLICT (code, user_id) DO NOTHING
  RETURNING user_id INTO inserted_grant;

  IF inserted_grant IS NULL THEN
    RETURN QUERY SELECT FALSE, target.handle, 0::BIGINT;
    RETURN;
  END IF;

  INSERT INTO wallets (user_id, balance)
  VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE wallets
  SET balance = balance + target.bonus_amount, updated_at = NOW()
  WHERE user_id = p_user_id
  RETURNING balance INTO balance_after;

  INSERT INTO transactions (
    request_key, client_id, mode, status, bonus_earned,
    balance_after, reason, reward_code, completed_at
  ) VALUES (
    'reward:' || p_user_id::TEXT || ':' || grant_code,
    p_user_id, 'achievement', 'completed', target.bonus_amount,
    balance_after, 'Поднять щиты — награда тестировщику', grant_code, NOW()
  ) ON CONFLICT (request_key) DO UPDATE SET request_key = EXCLUDED.request_key
  RETURNING id INTO tx_id;

  INSERT INTO special_achievement_grants (
    user_id, achievement_code, bonus_amount, transaction_id, deployment_hash, granted_at
  ) VALUES (
    p_user_id, target.achievement_code, target.bonus_amount, tx_id, 'red-cosmos-v2', NOW()
  ) ON CONFLICT (user_id, achievement_code) DO NOTHING;

  INSERT INTO user_achievements_v2 (
    user_id, achievement_code, is_granted, granted_at, current_progress, required_progress, last_progress_check_at
  ) VALUES (
    p_user_id, target.achievement_code, TRUE, NOW(), 1, 1, NOW()
  ) ON CONFLICT (user_id, achievement_code) DO UPDATE SET
    is_granted = TRUE,
    granted_at = COALESCE(user_achievements_v2.granted_at, EXCLUDED.granted_at),
    current_progress = 1,
    required_progress = 1,
    last_progress_check_at = NOW();

  UPDATE pending_special_achievement_recipients
  SET granted_user_id = p_user_id, granted_at = COALESCE(granted_at, NOW())
  WHERE handle = target.handle AND granted_user_id IS NULL;

  RETURN QUERY SELECT TRUE, target.handle, target.bonus_amount;
END;
$$;

ALTER TABLE wheel_spins DROP CONSTRAINT IF EXISTS wheel_spins_platform_check;
ALTER TABLE wheel_spins ADD CONSTRAINT wheel_spins_platform_check CHECK (platform IN ('telegram', 'vk'));
CREATE INDEX IF NOT EXISTS idx_wheel_spins_platform_created ON wheel_spins(platform, created_at DESC);
