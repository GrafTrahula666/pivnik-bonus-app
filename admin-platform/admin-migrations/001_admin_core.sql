-- CODEX Admin Platform Phase B.
-- ADDITIVE ONLY. This migration does not alter or remove any VK/TG production table.
-- Apply only to a test/staging DB first. Production application code does not depend on these tables.

BEGIN;

CREATE TABLE IF NOT EXISTS admin_schema_migrations (
  code TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS companies (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS venues (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  legacy_bar_id BIGINT UNIQUE REFERENCES bars(id) ON DELETE RESTRICT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, code)
);

CREATE TABLE IF NOT EXISTS admin_accounts (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN', 'VENUE_ADMIN')),
  password_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_accounts_email_lower
  ON admin_accounts ((LOWER(email)));

CREATE TABLE IF NOT EXISTS admin_company_access (
  admin_id BIGINT NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  access_kind TEXT NOT NULL DEFAULT 'trusted'
    CHECK (access_kind IN ('owner', 'trusted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(admin_id, company_id)
);
CREATE INDEX IF NOT EXISTS idx_admin_company_access_company
  ON admin_company_access(company_id, admin_id);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id BIGINT NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_agent TEXT,
  ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin
  ON admin_sessions(admin_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry
  ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id BIGSERIAL PRIMARY KEY,
  admin_id BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
  company_id BIGINT REFERENCES companies(id) ON DELETE SET NULL,
  venue_id BIGINT REFERENCES venues(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_value JSONB,
  after_value JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_tenant_time
  ON admin_audit_log(company_id, venue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_admin_time
  ON admin_audit_log(admin_id, created_at DESC);

-- PIVNIK is the first tenant. This maps the existing bars row; it never copies users.
INSERT INTO companies (code, name)
VALUES ('pivnik', 'ПИВНИК')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name, updated_at = NOW();

INSERT INTO venues (company_id, code, name, address, legacy_bar_id)
SELECT c.id, b.code, b.name, b.address, b.id
FROM companies c
JOIN bars b ON b.code = 'pivnik'
WHERE c.code = 'pivnik'
ON CONFLICT (legacy_bar_id) DO UPDATE
SET company_id = EXCLUDED.company_id,
    code = EXCLUDED.code,
    name = EXCLUDED.name,
    address = EXCLUDED.address,
    updated_at = NOW();

COMMIT;
