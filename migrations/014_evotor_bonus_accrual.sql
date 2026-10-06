-- Manual additive migration; NEVER run on startup. Depends on reviewed 012 and 013.
BEGIN;
-- The till reports which client was scanned into which open receipt. Money never
-- comes from here: the amount is read only from the closed cloud document.
CREATE TABLE IF NOT EXISTS pos_receipt_claims (
  source TEXT NOT NULL DEFAULT 'evotor' CHECK (source = 'evotor'),
  store_id TEXT NOT NULL REFERENCES pos_store_bindings(store_id),
  receipt_uuid TEXT NOT NULL CHECK (length(receipt_uuid) BETWEEN 1 AND 200),
  client_id BIGINT NOT NULL REFERENCES users(id),
  device_id UUID NOT NULL REFERENCES pos_devices(id),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source, store_id, receipt_uuid)
);
-- One row per closed document decides it exactly once (accrual for SELL,
-- reversal for PAYBACK), whether it applied or was skipped.
CREATE TABLE IF NOT EXISTS pos_bonus_accruals (
  source TEXT NOT NULL,
  store_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('accrue', 'reverse')),
  client_id BIGINT NOT NULL REFERENCES users(id),
  transaction_id BIGINT REFERENCES transactions(id),
  base_document_id TEXT,
  bonus_delta BIGINT NOT NULL,
  shortfall BIGINT NOT NULL DEFAULT 0 CHECK (shortfall >= 0),
  status TEXT NOT NULL CHECK (status IN ('applied', 'skipped')),
  skip_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source, store_id, document_id),
  FOREIGN KEY (source, store_id, document_id) REFERENCES pos_documents(source, store_id, document_id)
);
CREATE INDEX IF NOT EXISTS pos_bonus_accruals_base ON pos_bonus_accruals (source, store_id, base_document_id);
COMMIT;
