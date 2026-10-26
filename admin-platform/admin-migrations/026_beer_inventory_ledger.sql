-- Manual Admin metadata migration. Never run against the fiscal/guest DB.
-- An append-only calculation journal, NOT an Evotor stock writer.
BEGIN;
CREATE TABLE IF NOT EXISTS admin_beer_inventory_movements (
 sequence BIGSERIAL UNIQUE NOT NULL,
 operation_id UUID PRIMARY KEY,
 company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
 venue_id BIGINT NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
 store_id TEXT NOT NULL,
 product_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('initial','delivery','writeoff','physical_return','count')),
 quantity_millis BIGINT NOT NULL CHECK(quantity_millis BETWEEN 0 AND 9999999999),
 baseline_id UUID REFERENCES admin_beer_inventory_movements(operation_id) ON DELETE RESTRICT,
 effective_at TIMESTAMPTZ NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 actor_id BIGINT NOT NULL REFERENCES admin_accounts(id) ON DELETE RESTRICT,
 note TEXT NOT NULL DEFAULT '',
 invoice TEXT NOT NULL DEFAULT '',
 reason TEXT NOT NULL DEFAULT '',
 return_document_id TEXT,
 request_hash TEXT NOT NULL,
 evidence JSONB NOT NULL,
 CHECK(length(store_id) BETWEEN 1 AND 200 AND length(product_id) BETWEEN 1 AND 200),
 CHECK(length(note)<=500 AND length(invoice)<=100),
 CHECK((kind IN ('initial','count')) OR (quantity_millis>0 AND baseline_id IS NOT NULL)),
 CHECK((kind='initial' AND baseline_id IS NULL) OR kind<>'initial'),
 CHECK((kind='physical_return')=(return_document_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS admin_beer_inventory_scope ON admin_beer_inventory_movements(company_id,venue_id,store_id,product_id,sequence);
CREATE UNIQUE INDEX IF NOT EXISTS admin_beer_inventory_return_once ON admin_beer_inventory_movements(store_id,product_id,return_document_id) WHERE kind='physical_return';
COMMIT;
