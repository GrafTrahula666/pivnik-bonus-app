-- Manual additive migration. Never run at application startup.
BEGIN;
-- A choice belongs to one QR claim, including its timestamp and device. A later
-- customer replacement cannot inherit it, even if the first customer returns.
CREATE TABLE IF NOT EXISTS pos_receipt_beer (
  source TEXT NOT NULL DEFAULT 'evotor',
  store_id TEXT NOT NULL,
  receipt_uuid TEXT NOT NULL,
  client_id BIGINT NOT NULL REFERENCES users(id),
  device_id UUID NOT NULL REFERENCES pos_devices(id),
  claimed_at TIMESTAMPTZ NOT NULL,
  beer_ml INTEGER NOT NULL CHECK (beer_ml BETWEEN 0 AND 100000 AND beer_ml % 500 = 0),
  selected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(source,store_id,receipt_uuid),
  FOREIGN KEY(source,store_id,receipt_uuid) REFERENCES pos_receipt_claims(source,store_id,receipt_uuid)
);
-- Audit of canonical beer_loyalty changes, one decision per fiscal document.
-- Gift shortfalls after a refund require owner review, never a negative balance.
CREATE TABLE IF NOT EXISTS pos_beer_settlements (
  source TEXT NOT NULL DEFAULT 'evotor',
  store_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  base_document_id TEXT,
  paid_ml_delta INTEGER NOT NULL,
  gift_ml_delta INTEGER NOT NULL,
  gift_shortfall_ml INTEGER NOT NULL DEFAULT 0 CHECK(gift_shortfall_ml >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(source,store_id,document_id),
  FOREIGN KEY(source,store_id,document_id) REFERENCES pos_documents(source,store_id,document_id)
);
CREATE INDEX IF NOT EXISTS pos_beer_settlements_base ON pos_beer_settlements(source,store_id,base_document_id);
COMMIT;
