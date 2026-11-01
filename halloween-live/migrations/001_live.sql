-- MANUAL, additive. Never run at production startup. Review grants in README.
CREATE SCHEMA IF NOT EXISTS halloween_live;
CREATE TABLE IF NOT EXISTS halloween_live.events (
  id text PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 0,
  state jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS halloween_live.requests (
  key uuid PRIMARY KEY,
  actor text NOT NULL,
  action text NOT NULL,
  fingerprint text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS halloween_live.audit (
  id bigserial PRIMARY KEY,
  event_id text NOT NULL REFERENCES halloween_live.events(id),
  payload jsonb NOT NULL,
  previous_hash text NOT NULL,
  hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS halloween_live.sessions (
  hash text PRIMARY KEY,
  account text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','operator','scanner','screen')),
  credential_version text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS halloween_live.login_attempts (
  key text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 0,
  until_at timestamptz NOT NULL
);
