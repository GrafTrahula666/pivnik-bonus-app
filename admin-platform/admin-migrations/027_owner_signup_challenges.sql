-- CHAT 04 #492: manually reviewed additive owner email verification ledger.
-- Isolated Admin metadata only; no legacy guest/loyalty/POS data touched.
-- Never activate public signup solely because this table exists.
BEGIN;

CREATE TABLE IF NOT EXISTS admin_owner_signup_challenges (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  CHECK (email = LOWER(email) AND LENGTH(email) BETWEEN 3 AND 254),
  CHECK (LENGTH(display_name) BETWEEN 1 AND 80),
  CHECK (LENGTH(password_hash) BETWEEN 20 AND 512),
  CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);
CREATE INDEX IF NOT EXISTS admin_owner_signup_challenges_expiry
  ON admin_owner_signup_challenges(expires_at) WHERE consumed_at IS NULL;

COMMIT;
