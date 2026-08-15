-- Telegram-only daily wheel. Visual sector geometry is deliberately not stored here:
-- the server outcome is selected from the fixed 500,000-ticket prize table.

CREATE TABLE IF NOT EXISTS wheel_spins (
  id BIGSERIAL PRIMARY KEY,
  request_key TEXT NOT NULL UNIQUE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'telegram' CHECK (platform = 'telegram'),
  kind TEXT NOT NULL CHECK (kind IN ('free', 'paid_50', 'paid_100')),
  listed_bonus_cost BIGINT NOT NULL DEFAULT 0 CHECK (listed_bonus_cost IN (0, 50, 100)),
  charged_bonus_cost BIGINT NOT NULL DEFAULT 0 CHECK (charged_bonus_cost >= 0),
  prize_code TEXT NOT NULL CHECK (prize_code IN (
    'bonus-5', 'bonus-10', 'bonus-20', 'bonus-50',
    'bonus-100', 'beer-glass', 'annual-beer'
  )),
  bonus_awarded BIGINT NOT NULL DEFAULT 0 CHECK (bonus_awarded >= 0),
  beer_awarded_ml INTEGER NOT NULL DEFAULT 0 CHECK (beer_awarded_ml >= 0),
  random_ticket INTEGER NOT NULL CHECK (random_ticket >= 0 AND random_ticket < 500000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wheel_spins_user_created
  ON wheel_spins(user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_wheel_spins_user_free
  ON wheel_spins(user_id, created_at DESC, id DESC)
  WHERE kind = 'free';

CREATE TABLE IF NOT EXISTS wheel_annual_prizes (
  id BIGSERIAL PRIMARY KEY,
  spin_id BIGINT NOT NULL UNIQUE REFERENCES wheel_spins(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  daily_beer_ml INTEGER NOT NULL DEFAULT 500 CHECK (daily_beer_ml = 500),
  entitlement_days INTEGER NOT NULL DEFAULT 365 CHECK (entitlement_days = 365),
  starts_on DATE NOT NULL DEFAULT CURRENT_DATE,
  ends_on DATE NOT NULL DEFAULT (CURRENT_DATE + 364),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_on = starts_on + 364)
);

CREATE INDEX IF NOT EXISTS idx_wheel_annual_prizes_user
  ON wheel_annual_prizes(user_id, starts_on DESC);
