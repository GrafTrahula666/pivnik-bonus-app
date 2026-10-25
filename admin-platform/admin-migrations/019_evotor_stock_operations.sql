-- Manual additive Evotor operations ledger; do not deploy on startup.
BEGIN;
CREATE TABLE IF NOT EXISTS admin_evotor_stock_operations (
 id UUID PRIMARY KEY,
 venue_id BIGINT NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
 store_id TEXT NOT NULL,
 product_id TEXT NOT NULL,
 actor_id BIGINT NOT NULL REFERENCES admin_accounts(id) ON DELETE RESTRICT,
 delta_millis BIGINT NOT NULL CHECK(delta_millis BETWEEN 1 AND 10000000),
 before_millis BIGINT NOT NULL CHECK(before_millis >= 0),
 target_millis BIGINT NOT NULL CHECK(target_millis=before_millis+delta_millis),
 expected_updated_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('sent','confirmed','rejected','uncertain')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS admin_evotor_stock_venue_time ON admin_evotor_stock_operations(venue_id,created_at DESC);
CREATE INDEX IF NOT EXISTS admin_evotor_stock_pending ON admin_evotor_stock_operations(store_id,product_id) WHERE status IN ('sent','uncertain');
COMMIT;
