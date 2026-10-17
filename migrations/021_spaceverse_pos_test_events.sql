-- Manual/additive tenant metadata, after POS 012/013 and binding 017-019.
-- Test events never create receipts, purchases, customers or bonus operations.
BEGIN;
CREATE TABLE IF NOT EXISTS spaceverse_pos_test_events (
  device_id UUID NOT NULL REFERENCES pos_devices(id) ON DELETE RESTRICT,
  event_id UUID NOT NULL,
  runtime_key TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL CHECK(manifest_sha256 ~ '^[0-9a-f]{64}$'),
  company_id TEXT NOT NULL,
  venue_id TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(device_id,event_id),
  FOREIGN KEY(runtime_key,company_id,venue_id)
    REFERENCES spaceverse_runtime_binding(runtime_key,company_id,venue_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_spaceverse_pos_test_event_activity
  ON spaceverse_pos_test_events(device_id,runtime_key,manifest_sha256,received_at DESC);
COMMIT;
