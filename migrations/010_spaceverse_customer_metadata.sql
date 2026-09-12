-- SPACEVERSE Customer 360 metadata/audit foundation.
--
-- IMPORTANT: this migration is intentionally NOT wired into production startup.
-- It is additive only, mutates no existing rows, performs no backfill and must
-- not be applied until tenant/location attribution (migration 009) is verified.
--
-- Notes, tags and segments are represented as append-only events. Removal of a
-- tag/segment is another event rather than a destructive DELETE, preserving who
-- changed customer metadata, when, where and why.

CREATE TABLE IF NOT EXISTS spaceverse_customer_metadata_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  location_id TEXT,
  customer_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'note_added',
    'tag_added',
    'tag_removed',
    'segment_added',
    'segment_removed'
  )),
  value TEXT NOT NULL,
  reason TEXT NOT NULL,
  request_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (length(trim(tenant_id)) > 0),
  CHECK (location_id IS NULL OR length(trim(location_id)) > 0),
  CHECK (length(trim(customer_id)) > 0),
  CHECK (length(trim(actor_id)) > 0),
  CHECK (length(trim(value)) > 0),
  CHECK (length(trim(reason)) > 0),
  CHECK (length(trim(request_key)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_spaceverse_customer_metadata_scope_customer_time
  ON spaceverse_customer_metadata_events (tenant_id, location_id, customer_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_spaceverse_customer_metadata_scope_type_value_time
  ON spaceverse_customer_metadata_events (tenant_id, location_id, customer_id, event_type, value, created_at DESC, id DESC);

COMMENT ON TABLE spaceverse_customer_metadata_events IS
  'Append-only Customer 360 notes/tags/segments audit stream. Never use it to infer tenant ownership of historical users.';

COMMENT ON COLUMN spaceverse_customer_metadata_events.request_key IS
  'Caller supplied idempotency key. Replays must match the original semantic command exactly.';
