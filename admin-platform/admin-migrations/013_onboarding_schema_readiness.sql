-- Add the read-only tenant schema readiness step to the existing resumable
-- onboarding ledger. Apply manually after migrations 010 and 012. This
-- migration does not run tenant migrations, connect to a tenant database or
-- create resources.
BEGIN;

ALTER TABLE admin_onboarding_provisioning_steps
  DROP CONSTRAINT IF EXISTS admin_onboarding_provisioning_steps_step_check;

ALTER TABLE admin_onboarding_provisioning_steps
  ADD CONSTRAINT admin_onboarding_provisioning_steps_step_check
  CHECK (step IN ('runtime_database_binding', 'tenant_schema_readiness'));

COMMIT;
