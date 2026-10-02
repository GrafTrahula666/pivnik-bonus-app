-- BAR KIOSK DEVICE AUTH
-- SAFE / ADDITIVE ONLY. Do not auto-apply in production.
-- This migration creates new tables and indexes only; existing user/account data is untouched.

BEGIN;

CREATE TABLE IF NOT EXISTS bar_kiosk_pair_codes (
  id BIGSERIAL PRIMARY KEY,
  code_hash CHAR(64) NOT NULL UNIQUE,
  label TEXT NOT NULL,
  created_by_user_id BIGINT NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bar_kiosk_devices (
  id BIGSERIAL PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  user_id BIGINT NOT NULL REFERENCES users(id),
  label TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role = 'staff'),
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_by_user_id BIGINT NOT NULL REFERENCES users(id),
  paired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by_user_id BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bar_kiosk_bootstrap_codes (
  id BIGSERIAL PRIMARY KEY,
  device_id BIGINT NOT NULL REFERENCES bar_kiosk_devices(id) ON DELETE CASCADE,
  code_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bar_kiosk_pair_codes_active
  ON bar_kiosk_pair_codes (expires_at)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_bar_kiosk_devices_active
  ON bar_kiosk_devices (revoked_at, last_seen_at);

CREATE INDEX IF NOT EXISTS idx_bar_kiosk_bootstrap_active
  ON bar_kiosk_bootstrap_codes (expires_at)
  WHERE consumed_at IS NULL;

COMMIT;
