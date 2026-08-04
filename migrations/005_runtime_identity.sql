-- Stable logical database identity used to prove that VK and Telegram
-- are connected to the same production database.

CREATE TABLE IF NOT EXISTS runtime_identity (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton = TRUE),
  database_instance_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO runtime_identity (singleton, database_instance_id)
VALUES (
  TRUE,
  MD5(
    RANDOM()::TEXT
    || CLOCK_TIMESTAMP()::TEXT
    || PG_BACKEND_PID()::TEXT
    || CURRENT_DATABASE()
  )
)
ON CONFLICT (singleton) DO NOTHING;
