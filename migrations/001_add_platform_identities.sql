-- Pivnik: shared Telegram/VK identities and bar membership.
-- Safe to run repeatedly on PostgreSQL after the base Telegram schema exists.

BEGIN;

ALTER TABLE users
  ALTER COLUMN telegram_id DROP NOT NULL;

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

CREATE TABLE IF NOT EXISTS bar_customers (
  bar_id BIGINT NOT NULL REFERENCES bars(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'blocked', 'archived')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bar_id, user_id)
);

INSERT INTO bars (code, name, address)
VALUES ('pivnik', 'ПИВНИК', 'Санкт-Петербург, пр. Энгельса, 55')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    address = EXCLUDED.address,
    updated_at = NOW();

INSERT INTO user_identities (
  user_id,
  provider,
  provider_user_id,
  provider_username,
  profile_url
)
SELECT
  id,
  'telegram',
  telegram_id::text,
  username,
  photo_url
FROM users
WHERE telegram_id IS NOT NULL
ON CONFLICT (provider, provider_user_id) DO UPDATE
SET provider_username = EXCLUDED.provider_username,
    profile_url = EXCLUDED.profile_url,
    updated_at = NOW();

INSERT INTO bar_customers (bar_id, user_id)
SELECT b.id, u.id
FROM bars AS b
CROSS JOIN users AS u
WHERE b.code = 'pivnik'
ON CONFLICT (bar_id, user_id) DO NOTHING;

COMMIT;
