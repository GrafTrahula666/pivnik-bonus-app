-- SPACEVERSE authoritative tenant/location directory foundation.
--
-- IMPORTANT: this migration is intentionally NOT wired into production startup.
-- It is additive only, mutates no existing rows, performs no backfill and must
-- not infer tenants or locations from historical transactions.
--
-- Directory rows must be created only by an explicit administrative workflow
-- once tenant/location ownership has been verified independently.

CREATE TABLE IF NOT EXISTS spaceverse_tenants (
  tenant_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (length(trim(tenant_id)) > 0),
  CHECK (length(trim(display_name)) > 0)
);

CREATE TABLE IF NOT EXISTS spaceverse_locations (
  location_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES spaceverse_tenants(tenant_id) ON DELETE RESTRICT,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (length(trim(location_id)) > 0),
  CHECK (length(trim(tenant_id)) > 0),
  CHECK (length(trim(display_name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_spaceverse_locations_tenant_status_name
  ON spaceverse_locations (tenant_id, status, display_name, location_id);

COMMENT ON TABLE spaceverse_tenants IS
  'Authoritative SPACEVERSE tenant directory. Never populate by inferring ownership from historical transactions.';

COMMENT ON TABLE spaceverse_locations IS
  'Authoritative SPACEVERSE business-location directory. Each location belongs to exactly one verified tenant.';

COMMENT ON COLUMN spaceverse_tenants.status IS
  'Directory availability state only; authorization still requires canonical RBAC checks.';

COMMENT ON COLUMN spaceverse_locations.status IS
  'Directory availability state only; authorization still requires canonical RBAC checks.';
