-- PIVNIK RED COSMOS v2.1
-- Follow-up to immutable 007_red_cosmos_v2.sql.
-- Adds the recovered tester recipient and a Telegram username alias without
-- rewriting historical migration 007. Safe to run repeatedly.

INSERT INTO pending_special_achievement_recipients (
  handle, telegram_username, vk_provider_user_id, achievement_code, bonus_amount
) VALUES
  ('olesyaolese', 'olesyaolese', NULL, 'raise-shields', 750)
ON CONFLICT (handle) DO UPDATE SET
  telegram_username = EXCLUDED.telegram_username,
  vk_provider_user_id = COALESCE(pending_special_achievement_recipients.vk_provider_user_id, EXCLUDED.vk_provider_user_id),
  achievement_code = EXCLUDED.achievement_code,
  bonus_amount = EXCLUDED.bonus_amount;

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
      (p_provider = 'telegram' AND normalized_username <> '' AND (
        normalized_username = p.telegram_username
        OR (p.handle = 'drolted' AND normalized_username = 'drollted')
      ))
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
