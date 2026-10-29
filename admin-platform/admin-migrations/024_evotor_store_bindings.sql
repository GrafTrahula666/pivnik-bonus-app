-- Manual additive Admin migration 024; do NOT apply at startup or to production.
-- This is only an unmounted P0.2 store-ownership record, NOT an active tenant,
-- POS authorization, license or proof that a subscription is paid.
BEGIN;
CREATE TABLE IF NOT EXISTS admin_evotor_store_bindings (
  product_id UUID NOT NULL,
  store_id TEXT NOT NULL CHECK (store_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'),
  provider_user_id TEXT NOT NULL,
  company_id BIGINT NOT NULL REFERENCES companies(id),
  venue_id BIGINT NOT NULL REFERENCES venues(id),
  owner_admin_id BIGINT NOT NULL REFERENCES admin_accounts(id),
  token_revision BIGINT NOT NULL CHECK (token_revision > 0),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','hold','revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  conflict_at TIMESTAMPTZ,
  PRIMARY KEY (product_id, store_id),
  FOREIGN KEY (product_id, provider_user_id)
    REFERENCES admin_evotor_market_users(product_id, user_id)
);
CREATE INDEX IF NOT EXISTS admin_evotor_store_bindings_scope_idx
  ON admin_evotor_store_bindings(company_id, venue_id, product_id);
COMMIT;
