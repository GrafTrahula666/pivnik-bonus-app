-- Optional observation only; manual migration, never automatic startup.
-- Does not alter receipts, money, bonus state or historical scan cursors.
BEGIN;
CREATE TABLE IF NOT EXISTS pos_recent_sync_status (
 store_id TEXT PRIMARY KEY,
 state TEXT NOT NULL CHECK(state IN ('running','complete','incomplete','error')),
 since_at TIMESTAMPTZ NOT NULL,
 until_at TIMESTAMPTZ NOT NULL,
 pages INTEGER NOT NULL DEFAULT 0,
 cursor_pending BOOLEAN NOT NULL DEFAULT FALSE,
 last_error_code TEXT,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 last_success_at TIMESTAMPTZ,
 success_since TIMESTAMPTZ,
 success_until TIMESTAMPTZ
);
COMMIT;
