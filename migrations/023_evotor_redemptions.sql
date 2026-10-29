-- Manual, additive migration. Never run at startup. Existing accruals are unchanged.
CREATE TABLE IF NOT EXISTS pos_redemptions (
  id UUID PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'evotor' CHECK (source='evotor'),
  store_id TEXT NOT NULL REFERENCES pos_store_bindings(store_id),
  receipt_uuid TEXT NOT NULL,
  device_id UUID NOT NULL REFERENCES pos_devices(id),
  client_id BIGINT NOT NULL REFERENCES users(id),
  points BIGINT NOT NULL CHECK (points>0 AND points<=90071992547409),
  total_cents BIGINT NOT NULL CHECK (total_cents>0 AND total_cents<=9007199254740991),
  basket_hash TEXT NOT NULL CHECK (basket_hash ~ '^[a-f0-9]{64}$'),
  wallet_debited BOOLEAN NOT NULL,
  transaction_id BIGINT NOT NULL REFERENCES transactions(id),
  state TEXT NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','committed','released','review')),
  review_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (points*100<=total_cents*0.30)
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_redemptions_open_receipt
  ON pos_redemptions(source,store_id,receipt_uuid) WHERE state<>'released';
CREATE INDEX IF NOT EXISTS pos_redemptions_reconcile
  ON pos_redemptions(store_id,state);
-- A cancel may overtake a timed-out reserve before it reached the server.
-- Keep a tombstone so that delayed request can never debit after cancellation.
CREATE TABLE IF NOT EXISTS pos_redemption_cancellations (
  id UUID PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES pos_store_bindings(store_id),
  receipt_uuid TEXT NOT NULL,
  device_id UUID NOT NULL REFERENCES pos_devices(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS pos_redemption_refunds (
  source TEXT NOT NULL DEFAULT 'evotor' CHECK (source='evotor'),
  store_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  redemption_id UUID NOT NULL REFERENCES pos_redemptions(id),
  returned_cents BIGINT NOT NULL CHECK (returned_cents>=0),
  points BIGINT NOT NULL CHECK (points>=0),
  transaction_id BIGINT REFERENCES transactions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(source,store_id,document_id)
);
