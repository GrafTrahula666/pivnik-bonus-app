-- Add deterministic runtime bundle verification to the existing resumable
-- onboarding ledger. Apply manually after migrations 010 and 013. This
-- migration does not build, start or publish a service and creates no secrets.
BEGIN;

ALTER TABLE admin_onboarding_provisioning_steps
  DROP CONSTRAINT IF EXISTS admin_onboarding_provisioning_steps_step_check;

ALTER TABLE admin_onboarding_provisioning_steps
  ADD CONSTRAINT admin_onboarding_provisioning_steps_step_check
  CHECK (step IN (
    'runtime_database_binding',
    'tenant_schema_readiness',
    'runtime_bundle_verification'
  ));

COMMIT;
