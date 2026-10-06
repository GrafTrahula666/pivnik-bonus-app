-- Manual, additive migration. Not in automatic startup allowlist.
BEGIN;
CREATE TABLE IF NOT EXISTS pos_documents (
  source TEXT NOT NULL CHECK (source = 'evotor'),
  store_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('SELL', 'PAYBACK')),
  closed_at TIMESTAMPTZ NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  snapshot JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source, store_id, document_id)
);
CREATE INDEX IF NOT EXISTS pos_documents_period ON pos_documents (store_id, closed_at);
CREATE TABLE IF NOT EXISTS pos_customer_links (
  source TEXT NOT NULL,
  store_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  client_id BIGINT NOT NULL REFERENCES users(id),
  confirmed_by BIGINT NOT NULL REFERENCES users(id),
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source, store_id, document_id),
  FOREIGN KEY (source, store_id, document_id) REFERENCES pos_documents(source, store_id, document_id)
);
CREATE TABLE IF NOT EXISTS pos_sync_state (
  store_id TEXT PRIMARY KEY,
  cursor TEXT,
  scan_until TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error_code TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMIT;
