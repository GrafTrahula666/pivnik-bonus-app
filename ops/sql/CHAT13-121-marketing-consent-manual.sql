-- CHAT 13 / 121: MANUAL / UNMOUNTED / NOT FOR PRODUCTION EXECUTION.
-- Dedicated SPACEVERSE tenant CRM database only, after migrations 017-019.
-- NOT in migrations/ or admin-platform/admin-migrations/: neither startup nor
-- an Admin migration runner discovers this file. Review ownership and live
-- provider policy before any operator manually executes it.
-- No history backfill, no current marketing permission granted.
BEGIN;

-- Composite FK prevents evidence assigned to a foreign company/venue/runtime.
CREATE UNIQUE INDEX IF NOT EXISTS idx_spaceverse_customer_ownership_consent_fk
  ON spaceverse_customer_ownership (user_id, runtime_key, company_id, venue_id);

CREATE TABLE IF NOT EXISTS spaceverse_marketing_consent_events (
  event_id UUID PRIMARY KEY,
  user_id BIGINT NOT NULL,
  runtime_key TEXT NOT NULL,
  company_id TEXT NOT NULL,
  venue_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('telegram','vk')),
  purpose TEXT NOT NULL CHECK (purpose = 'marketing'),
  action TEXT NOT NULL CHECK (action IN ('grant','revoke')),
  provider_identity_id TEXT NOT NULL CHECK (length(provider_identity_id) BETWEEN 1 AND 200),
  consent_text_version TEXT,
  consent_text_sha256 TEXT,
  source_surface TEXT NOT NULL CHECK (source_surface IN ('telegram_mini_app','vk_mini_app')),
  authenticated_actor_user_id BIGINT NOT NULL,
  explicit_opt_in BOOLEAN NOT NULL,
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 1 AND 128),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  server_recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT spaceverse_marketing_consent_customer_fk
    FOREIGN KEY (user_id, runtime_key, company_id, venue_id)
    REFERENCES spaceverse_customer_ownership (user_id, runtime_key, company_id, venue_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT spaceverse_marketing_consent_actor_check
    CHECK (authenticated_actor_user_id = user_id),
  CONSTRAINT spaceverse_marketing_consent_surface_check
    CHECK ((channel='telegram' AND source_surface='telegram_mini_app')
        OR (channel='vk' AND source_surface='vk_mini_app')),
  CONSTRAINT spaceverse_marketing_consent_action_check CHECK (
    (action = 'grant' AND explicit_opt_in = TRUE
      AND length(consent_text_version) BETWEEN 1 AND 128
      AND consent_text_sha256 ~ '^[a-f0-9]{64}$')
    OR (action = 'revoke' AND explicit_opt_in = FALSE)
  ),
  CONSTRAINT spaceverse_marketing_consent_scope_key
    UNIQUE (event_id, user_id, runtime_key, company_id, venue_id, channel, purpose),
  CONSTRAINT spaceverse_marketing_consent_request_once
    UNIQUE (user_id, runtime_key, company_id, venue_id, channel, purpose, idempotency_key)
);

-- Head pointer is the only valid 'latest' read. BIGSERIAL/timestamps are NOT
-- reliable commit order during concurrent grants/revocations.
-- Future writer MUST atomically insert event + upsert the head in one
-- transaction, locking this exact key, rejecting conflicting idempotent replay.
CREATE TABLE IF NOT EXISTS spaceverse_marketing_consent_heads (
  user_id BIGINT NOT NULL,
  runtime_key TEXT NOT NULL,
  company_id TEXT NOT NULL,
  venue_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('telegram','vk')),
  purpose TEXT NOT NULL CHECK (purpose = 'marketing'),
  latest_event_id UUID NOT NULL,
  PRIMARY KEY (user_id, runtime_key, company_id, venue_id, channel, purpose),
  CONSTRAINT spaceverse_marketing_consent_head_event_fk
    FOREIGN KEY (latest_event_id, user_id, runtime_key, company_id, venue_id, channel, purpose)
    REFERENCES spaceverse_marketing_consent_events
      (event_id, user_id, runtime_key, company_id, venue_id, channel, purpose)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

-- History is append-only at the DB API, not merely application convention.
CREATE OR REPLACE FUNCTION spaceverse_marketing_consent_event_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'marketing consent evidence is immutable';
END;
$$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'spaceverse_marketing_consent_events'::regclass
        AND tgname = 'trg_spaceverse_marketing_consent_immutable') THEN
    CREATE TRIGGER trg_spaceverse_marketing_consent_immutable
      BEFORE UPDATE OR DELETE ON spaceverse_marketing_consent_events
      FOR EACH ROW EXECUTE FUNCTION spaceverse_marketing_consent_event_immutable();
  END IF;
END $$;

-- No grants, provider permissions, tenant activation, campaign routes or sends.
COMMIT;
