-- Persist the single application creator independently from mutable roles and
-- from whichever Telegram/VK identity is used to open the unified account.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_creator BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_creator
  ON users ((1))
  WHERE is_creator = TRUE;
