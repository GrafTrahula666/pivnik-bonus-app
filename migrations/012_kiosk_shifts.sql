-- BAR KIOSK SHIFTS (open/close shift, shift report + closing receipt photos,
-- invoices, owner notifications outbox).
-- SAFE / ADDITIVE ONLY. Not an automatic startup migration: apply with
--   node scripts/apply-kiosk-shifts-migration.mjs --confirm APPLY_KIOSK_SHIFTS_012
-- Creates new kiosk_shift_* tables only; existing user/loyalty data is untouched.

BEGIN;

CREATE TABLE IF NOT EXISTS kiosk_shift_devices (
  id BIGSERIAL PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS kiosk_shifts (
  id BIGSERIAL PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  device_id BIGINT NOT NULL REFERENCES kiosk_shift_devices(id),
  employee_name TEXT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL,
  opened_local_date DATE NOT NULL,
  opened_local_time TEXT NOT NULL,
  late BOOLEAN NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'left_unclosed')),
  report_status TEXT NOT NULL DEFAULT 'missing' CHECK (report_status IN ('missing', 'pending', 'rejected', 'accepted')),
  receipt_status TEXT NOT NULL DEFAULT 'missing' CHECK (receipt_status IN ('missing', 'pending', 'rejected', 'accepted')),
  report_fields JSONB,
  report_signature_present BOOLEAN,
  report_validation JSONB,
  receipt_validation JSONB,
  report_pending_since TIMESTAMPTZ,
  receipt_pending_since TIMESTAMPTZ,
  report_rejections INTEGER NOT NULL DEFAULT 0,
  receipt_rejections INTEGER NOT NULL DEFAULT 0,
  closed_at TIMESTAMPTZ,
  closed_local_time TEXT,
  left_unclosed_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kiosk_shifts_device_status ON kiosk_shifts (device_id, status, opened_at DESC);

CREATE TABLE IF NOT EXISTS kiosk_shift_photos (
  id BIGSERIAL PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  shift_id BIGINT NOT NULL REFERENCES kiosk_shifts(id),
  kind TEXT NOT NULL CHECK (kind IN ('report', 'receipt', 'invoice')),
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sha256 CHAR(64) NOT NULL,
  data BYTEA NOT NULL,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kiosk_shift_photos_shift ON kiosk_shift_photos (shift_id, kind);

-- Every AI check attempt, accepted or not (audit trail).
CREATE TABLE IF NOT EXISTS kiosk_shift_validations (
  id BIGSERIAL PRIMARY KEY,
  shift_id BIGINT NOT NULL REFERENCES kiosk_shifts(id),
  kind TEXT NOT NULL CHECK (kind IN ('report', 'receipt')),
  photo_ids JSONB NOT NULL,
  model TEXT,
  accepted BOOLEAN NOT NULL,
  decision JSONB NOT NULL,
  raw_result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Shift history (opened, late, previous not closed, documents, closed ...).
CREATE TABLE IF NOT EXISTS kiosk_shift_events (
  id BIGSERIAL PRIMARY KEY,
  shift_id BIGINT REFERENCES kiosk_shifts(id),
  device_id BIGINT REFERENCES kiosk_shift_devices(id),
  type TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kiosk_shift_events_shift ON kiosk_shift_events (shift_id, created_at);

-- "Previous shift was not closed" incidents. Recorded only: the owner decides
-- whether it is a violation. No money is ever deducted automatically.
CREATE TABLE IF NOT EXISTS kiosk_shift_incidents (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('previous_shift_unclosed')),
  previous_shift_public_id TEXT NOT NULL,
  previous_employee_name TEXT,
  previous_opened_at TIMESTAMPTZ,
  new_shift_id BIGINT NOT NULL REFERENCES kiosk_shifts(id),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  owner_decision TEXT CHECK (owner_decision IN ('confirmed', 'dismissed')),
  owner_decided_at TIMESTAMPTZ,
  UNIQUE (type, previous_shift_public_id)
);

-- Durable delivery queue for Telegram and Google Sheets (retried until done).
CREATE TABLE IF NOT EXISTS kiosk_shift_outbox (
  id BIGSERIAL PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL CHECK (channel IN ('telegram', 'sheets')),
  payload JSONB NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  done_at TIMESTAMPTZ,
  abandoned_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kiosk_shift_outbox_due ON kiosk_shift_outbox (next_attempt_at) WHERE done_at IS NULL AND abandoned_at IS NULL;

COMMIT;
