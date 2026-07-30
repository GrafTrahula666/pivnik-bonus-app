-- Unified Telegram/VK identity, account-linking and merge schema.
-- The runtime migration runner executes this file once inside a transaction.

ALTER TABLE users
  ALTER COLUMN telegram_id DROP NOT NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS merged_into_user_id BIGINT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS merged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS session_version BIGINT NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_users_merged_into
  ON users(merged_into_user_id);

CREATE TABLE IF NOT EXISTS bars (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  address TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_identities (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('telegram', 'vk')),
  provider_user_id TEXT NOT NULL,
  provider_username TEXT,
  profile_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_user_id),
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_user_identities_user
  ON user_identities(user_id, provider);

CREATE TABLE IF NOT EXISTS bar_customers (
  bar_id BIGINT NOT NULL REFERENCES bars(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'blocked', 'archived')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bar_id, user_id)
);

CREATE TABLE IF NOT EXISTS reward_grants (
  code TEXT NOT NULL,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount BIGINT NOT NULL DEFAULT 0 CHECK (amount >= 0),
  source TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (code, user_id)
);

CREATE TABLE IF NOT EXISTS platform_migrations (
  code TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS account_link_codes (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_provider TEXT NOT NULL CHECK (source_provider IN ('telegram', 'vk')),
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  used_by_user_id BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_account_link_codes_user
  ON account_link_codes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_account_link_codes_expiry
  ON account_link_codes(expires_at);

CREATE TABLE IF NOT EXISTS account_link_attempts (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  success BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_account_link_attempts_user
  ON account_link_attempts(user_id, attempted_at DESC);

CREATE TABLE IF NOT EXISTS qr_aliases (
  id BIGSERIAL PRIMARY KEY,
  qr_token TEXT UNIQUE,
  qr_short_code TEXT UNIQUE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_user_id BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (qr_token IS NOT NULL OR qr_short_code IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_qr_aliases_user
  ON qr_aliases(user_id);

CREATE TABLE IF NOT EXISTS account_merge_audit (
  id BIGSERIAL PRIMARY KEY,
  canonical_user_id BIGINT NOT NULL REFERENCES users(id),
  merged_user_id BIGINT NOT NULL REFERENCES users(id),
  duplicate_bonus_removed BIGINT NOT NULL DEFAULT 0 CHECK (duplicate_bonus_removed >= 0),
  duplicate_bonus_unrecovered BIGINT NOT NULL DEFAULT 0 CHECK (duplicate_bonus_unrecovered >= 0),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS reward_code TEXT,
  ADD COLUMN IF NOT EXISTS cancel_request_key TEXT;

ALTER TABLE transactions
  ALTER COLUMN bonus_spent TYPE BIGINT,
  ALTER COLUMN bonus_earned TYPE BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_cancel_request_key
  ON transactions(cancel_request_key)
  WHERE cancel_request_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_reward
  ON transactions(client_id, reward_code, status)
  WHERE reward_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_leaderboard
  ON transactions(created_at, client_id)
  INCLUDE (cash_paid_cents)
  WHERE status = 'completed' AND mode IN ('accrue', 'redeem');
