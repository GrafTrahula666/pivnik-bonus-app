-- Manual Admin metadata migration after 014. Reuse the existing onboarding
-- operation ledger; do not create another tenant identity or activate a venue.
BEGIN;

ALTER TABLE admin_onboarding_provisioning_steps
  DROP CONSTRAINT IF EXISTS admin_onboarding_provisioning_steps_step_check;
ALTER TABLE admin_onboarding_provisioning_steps
  ADD CONSTRAINT admin_onboarding_provisioning_steps_step_check
  CHECK (step IN ('runtime_database_binding','tenant_schema_readiness',
    'runtime_bundle_verification','crm_activation_check'));

-- This iteration cannot certify activation: the Market contract is missing.
-- Fail closed even if application code accidentally attempts to save success.
ALTER TABLE admin_onboarding_provisioning_steps
  ADD CONSTRAINT admin_onboarding_crm_activation_pending_check
  CHECK (step <> 'crm_activation_check' OR status <> 'succeeded');

COMMIT;
