-- Optional additive beer arrival counter in Admin metadata. Manual migration only.
BEGIN;
CREATE TABLE IF NOT EXISTS admin_beer_intake_balance (
 venue_id BIGINT NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
 product_key TEXT NOT NULL CHECK (product_key ~ '^beer-(0[1-9]|[12][0-9]|3[0-5])$'),
 liters_millis BIGINT NOT NULL DEFAULT 0 CHECK (liters_millis >= 0),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(venue_id,product_key)
);
CREATE TABLE IF NOT EXISTS admin_beer_intake_operations (
 operation_id UUID PRIMARY KEY,
 venue_id BIGINT NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
 product_key TEXT NOT NULL CHECK (product_key ~ '^beer-(0[1-9]|[12][0-9]|3[0-5])$'),
 added_millis BIGINT NOT NULL CHECK (added_millis > 0 AND added_millis <= 10000000),
 created_by BIGINT NOT NULL REFERENCES admin_accounts(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_beer_intake_venue_time ON admin_beer_intake_operations(venue_id,created_at DESC);
COMMIT;
