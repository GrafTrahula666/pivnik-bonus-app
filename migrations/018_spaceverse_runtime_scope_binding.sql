-- Manual, additive extension of the dedicated SPACEVERSE database binding.
-- Scope is never inferred from request data. Existing rows without canonical
-- IDs remain unusable until an operator binds them through the reviewed flow.

BEGIN;

ALTER TABLE spaceverse_runtime_binding
  ADD COLUMN IF NOT EXISTS company_id TEXT,
  ADD COLUMN IF NOT EXISTS venue_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'spaceverse_runtime_binding'::regclass
      AND conname = 'spaceverse_runtime_binding_company_id_check'
  ) THEN
    ALTER TABLE spaceverse_runtime_binding
      ADD CONSTRAINT spaceverse_runtime_binding_company_id_check
      CHECK (company_id IS NULL OR company_id ~ '^[1-9][0-9]{0,18}$');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'spaceverse_runtime_binding'::regclass
      AND conname = 'spaceverse_runtime_binding_venue_id_check'
  ) THEN
    ALTER TABLE spaceverse_runtime_binding
      ADD CONSTRAINT spaceverse_runtime_binding_venue_id_check
      CHECK (venue_id IS NULL OR venue_id ~ '^[1-9][0-9]{0,18}$');
  END IF;
END $$;

COMMIT;
