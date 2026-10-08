BEGIN;
CREATE TABLE IF NOT EXISTS venue_settings(
  venue_id BIGINT PRIMARY KEY REFERENCES venues(id) ON DELETE CASCADE,
  base_cashback_percent NUMERIC(7,4),
  registration_bonus BIGINT,
  referral_bonus BIGINT,
  wheel_enabled BOOLEAN,
  shop_enabled BOOLEAN,
  achievements_enabled BOOLEAN,
  referrals_enabled BOOLEAN,
  promotions_enabled BOOLEAN,
  branding_enabled BOOLEAN,
  branding JSONB NOT NULL DEFAULT '{}'::jsonb,
  phone TEXT,
  links JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS loyalty_levels(
  id BIGSERIAL PRIMARY KEY,
  venue_id BIGINT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  threshold_cents BIGINT NOT NULL CHECK(threshold_cents>=0),
  bonus_percent NUMERIC(7,4) NOT NULL CHECK(bonus_percent>=0 AND bonus_percent<=100),
  discount_percent NUMERIC(7,4) NOT NULL DEFAULT 0 CHECK(discount_percent>=0 AND discount_percent<=100),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(venue_id,code)
);
CREATE INDEX IF NOT EXISTS idx_loyalty_levels_venue ON loyalty_levels(venue_id,sort_order,id);

CREATE TABLE IF NOT EXISTS wheel_configs(
  venue_id BIGINT PRIMARY KEY REFERENCES venues(id) ON DELETE CASCADE,
  enabled BOOLEAN,
  cooldown_minutes INTEGER CHECK(cooldown_minutes IS NULL OR cooldown_minutes>=0),
  retry_cost BIGINT CHECK(retry_cost IS NULL OR retry_cost>=0),
  version BIGINT NOT NULL DEFAULT 1,
  updated_by BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS wheel_prizes(
  id BIGSERIAL PRIMARY KEY,
  venue_id BIGINT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  reward_type TEXT NOT NULL CHECK(reward_type IN('bonus','beer_ml','item','frame','retry','none')),
  reward_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  probability_ppb BIGINT NOT NULL CHECK(probability_ppb>=0 AND probability_ppb<=1000000000),
  inventory_limit INTEGER CHECK(inventory_limit IS NULL OR inventory_limit>=0),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(venue_id,code)
);
CREATE INDEX IF NOT EXISTS idx_wheel_prizes_venue ON wheel_prizes(venue_id,sort_order,id);

CREATE TABLE IF NOT EXISTS achievement_configs(
  id BIGSERIAL PRIMARY KEY,
  venue_id BIGINT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_src TEXT,
  condition_type TEXT NOT NULL,
  threshold_value NUMERIC,
  reward_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN('public','hidden')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  legacy_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(venue_id,code)
);

CREATE TABLE IF NOT EXISTS shop_item_configs(
  id BIGSERIAL PRIMARY KEY,
  venue_id BIGINT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_src TEXT,
  category TEXT NOT NULL DEFAULT 'other',
  reward_type TEXT NOT NULL DEFAULT 'item',
  reward_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  bonus_price BIGINT NOT NULL DEFAULT 0 CHECK(bonus_price>=0),
  stock INTEGER CHECK(stock IS NULL OR stock>=0),
  purchase_limit INTEGER CHECK(purchase_limit IS NULL OR purchase_limit>=0),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  legacy_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(venue_id,code)
);

CREATE TABLE IF NOT EXISTS promotion_configs(
  id BIGSERIAL PRIMARY KEY,
  venue_id BIGINT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_src TEXT,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  mechanic JSONB NOT NULL DEFAULT '{}'::jsonb,
  reward JSONB NOT NULL DEFAULT '{}'::jsonb,
  multiplier NUMERIC(10,4),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(venue_id,code),
  CHECK(ends_at IS NULL OR starts_at IS NULL OR ends_at>starts_at)
);
COMMIT;
