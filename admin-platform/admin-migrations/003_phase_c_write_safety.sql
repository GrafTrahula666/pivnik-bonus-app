BEGIN;
ALTER TABLE admin_audit_log ADD COLUMN IF NOT EXISTS admin_role TEXT;
ALTER TABLE admin_audit_log ADD COLUMN IF NOT EXISTS reason TEXT;

CREATE TABLE IF NOT EXISTS admin_idempotency_keys(
  id BIGSERIAL PRIMARY KEY,
  admin_id BIGINT NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
  venue_id BIGINT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(admin_id,venue_id,operation,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_admin_idempotency_created ON admin_idempotency_keys(created_at);

CREATE TABLE IF NOT EXISTS admin_bonus_adjustments(
  id BIGSERIAL PRIMARY KEY,
  admin_id BIGINT NOT NULL REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  venue_id BIGINT NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
  user_id BIGINT NOT NULL,
  adjustment_type TEXT NOT NULL CHECK(adjustment_type IN('credit','debit')),
  amount BIGINT NOT NULL CHECK(amount>0),
  reason TEXT NOT NULL,
  production_transaction_id BIGINT,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(venue_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_admin_bonus_user ON admin_bonus_adjustments(venue_id,user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS manual_achievement_grants(
  id BIGSERIAL PRIMARY KEY,
  admin_id BIGINT NOT NULL REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  venue_id BIGINT NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
  user_id BIGINT NOT NULL,
  achievement_code TEXT NOT NULL,
  reason TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(venue_id,user_id,achievement_code,idempotency_key)
);


CREATE TABLE IF NOT EXISTS customer_cashback_overrides(
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  venue_id BIGINT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  cashback_percent NUMERIC(7,4) NOT NULL CHECK(cashback_percent>=0 AND cashback_percent<=100),
  reason TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(venue_id,user_id)
);

CREATE TABLE IF NOT EXISTS admin_customer_entitlements(
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  venue_id BIGINT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  entitlement_type TEXT NOT NULL CHECK(entitlement_type IN('item','frame','digital_reward')),
  entitlement_code TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'admin',
  granted_by BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(venue_id,user_id,entitlement_type,entitlement_code)
);

CREATE TABLE IF NOT EXISTS analytics_events(
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT REFERENCES companies(id) ON DELETE SET NULL,
  venue_id BIGINT REFERENCES venues(id) ON DELETE SET NULL,
  user_id BIGINT,
  platform TEXT,
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT
);
CREATE INDEX IF NOT EXISTS idx_analytics_events_venue_time ON analytics_events(venue_id,occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_events_idempotency
  ON analytics_events(venue_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMIT;
