-- Manual additive migration; NEVER run on startup. Depends on reviewed 012.
BEGIN;
CREATE TABLE IF NOT EXISTS pos_store_bindings (
  store_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 200),
  location_id TEXT NOT NULL CHECK (length(location_id) BETWEEN 1 AND 200),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (tenant_id, location_id)
);
-- Explicit access, not inferred from historical global users.role.
CREATE TABLE IF NOT EXISTS pos_operator_access (
  user_id BIGINT NOT NULL REFERENCES users(id),
  store_id TEXT NOT NULL REFERENCES pos_store_bindings(store_id),
  can_manage BOOLEAN NOT NULL DEFAULT FALSE,
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, store_id)
);
CREATE TABLE IF NOT EXISTS pos_devices (
  id UUID PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES pos_store_bindings(store_id),
  external_device_id TEXT NOT NULL CHECK (length(external_device_id) BETWEEN 1 AND 200),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 100),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by BIGINT REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS pos_device_audit (
  id BIGSERIAL PRIMARY KEY,
  device_id UUID NOT NULL REFERENCES pos_devices(id),
  action TEXT NOT NULL CHECK (action IN ('issued','revoked')),
  actor_id BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_devices_active_external_id
  ON pos_devices(store_id,external_device_id) WHERE revoked_at IS NULL;
COMMIT;
