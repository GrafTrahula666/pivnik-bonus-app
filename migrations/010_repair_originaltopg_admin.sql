-- One-time production repair for the active Telegram profile @OriginalTopG.
-- Safety requirements:
-- - exactly one active, non-merged user must resolve through a Telegram identity;
-- - match is case-insensitive and accepts either the canonical users.username
--   or the provider_username recorded on that Telegram identity;
-- - only users.role is changed;
-- - no balances, bonuses, identities, sessions, frames or profile data are modified.
--
-- The automatic migration runner records this file in schema_migrations, so the
-- repair is applied at most once per database even though both Telegram and VK
-- services share the same production database.

DO $$
DECLARE
  target_user_id BIGINT;
  candidate_count INTEGER;
BEGIN
  SELECT COUNT(DISTINCT u.id)::INTEGER,
         MIN(u.id)
    INTO candidate_count, target_user_id
  FROM users u
  JOIN user_identities ui
    ON ui.user_id = u.id
   AND ui.provider = 'telegram'
  WHERE u.merged_into_user_id IS NULL
    AND u.deleted_at IS NULL
    AND (
      LOWER(REGEXP_REPLACE(COALESCE(u.username, ''), '^@+', '')) = 'originaltopg'
      OR LOWER(REGEXP_REPLACE(COALESCE(ui.provider_username, ''), '^@+', '')) = 'originaltopg'
    );

  IF candidate_count <> 1 OR target_user_id IS NULL THEN
    RAISE EXCEPTION
      'OriginalTopG admin repair requires exactly one active Telegram account; found %',
      candidate_count;
  END IF;

  UPDATE users
  SET role = 'admin',
      updated_at = CASE WHEN role <> 'admin' THEN NOW() ELSE updated_at END
  WHERE id = target_user_id;

  IF NOT EXISTS (
    SELECT 1
    FROM users
    WHERE id = target_user_id
      AND role = 'admin'
      AND merged_into_user_id IS NULL
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'OriginalTopG admin repair verification failed';
  END IF;
END;
$$;
