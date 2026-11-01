-- SPACEVERSE CHAT 03 / 24: manual CRM contacts are NOT authenticated app users.
-- Apply only to an already dedicated, prepared tenant DB after migrations 017-019.
-- Intentionally unmounted and not part of startup or automatic bootstrap.
-- No legacy PIVNIK rows, provider identity, wallet or customer ownership are created.
BEGIN;

DO $$
BEGIN
  IF current_setting('spaceverse.crm_contacts_migration', TRUE) IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Explicit reviewed CRM contact migration required';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS spaceverse_crm_contacts (
  id BIGSERIAL PRIMARY KEY,
  runtime_key TEXT NOT NULL,
  company_id TEXT NOT NULL CHECK (company_id ~ '^[1-9][0-9]{0,18}$'),
  venue_id TEXT NOT NULL CHECK (venue_id ~ '^[1-9][0-9]{0,18}$'),
  first_name TEXT NOT NULL CHECK (length(trim(first_name)) BETWEEN 1 AND 120),
  last_name TEXT CHECK (last_name IS NULL OR length(trim(last_name)) BETWEEN 1 AND 120),
  phone_e164 TEXT CHECK (phone_e164 IS NULL OR (left(phone_e164,1)='+' AND substring(phone_e164 from 2) ~ '^[1-9][0-9]{7,14}$')),
  email_normalized TEXT CHECK (email_normalized IS NULL OR length(email_normalized) BETWEEN 3 AND 254),
  creation_origin TEXT NOT NULL DEFAULT 'manual' CHECK (creation_origin = 'manual'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  CONSTRAINT spaceverse_crm_contact_has_channel
    CHECK (phone_e164 IS NOT NULL OR email_normalized IS NOT NULL),
  CONSTRAINT spaceverse_crm_contacts_scope_fkey
    FOREIGN KEY (runtime_key,company_id,venue_id)
    REFERENCES spaceverse_runtime_binding(runtime_key,company_id,venue_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);
-- Distinct contacts sharing a name are allowed; exact contact channels cannot
-- silently be assigned to two active records at the same venue.
CREATE UNIQUE INDEX IF NOT EXISTS spaceverse_crm_contacts_phone_uq
  ON spaceverse_crm_contacts(runtime_key,company_id,venue_id,phone_e164)
  WHERE phone_e164 IS NOT NULL AND archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS spaceverse_crm_contacts_email_uq
  ON spaceverse_crm_contacts(runtime_key,company_id,venue_id,email_normalized)
  WHERE email_normalized IS NOT NULL AND archived_at IS NULL;

CREATE TABLE IF NOT EXISTS spaceverse_crm_contact_create_requests (
  runtime_key TEXT NOT NULL,
  request_key UUID NOT NULL,
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  -- Metadata Admin principal, never an identity supplied by a contact form.
  created_by_admin_id BIGINT NOT NULL CHECK (created_by_admin_id > 0),
  company_id TEXT NOT NULL,
  venue_id TEXT NOT NULL,
  contact_id BIGINT UNIQUE REFERENCES spaceverse_crm_contacts(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY(runtime_key,request_key),
  CONSTRAINT spaceverse_crm_contact_request_scope_fkey
    FOREIGN KEY(runtime_key,company_id,venue_id)
    REFERENCES spaceverse_runtime_binding(runtime_key,company_id,venue_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT spaceverse_crm_contact_request_complete
    CHECK ((contact_id IS NULL) = (completed_at IS NULL))
);

COMMIT;
