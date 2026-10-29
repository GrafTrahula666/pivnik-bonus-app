-- Manual additive migration. No startup execution, default zero or balance writes.
BEGIN;
ALTER TABLE pos_documents ADD COLUMN IF NOT EXISTS redemption_effect JSONB;
COMMIT;
