# CHAT 03 / #24 — manual CRM contact migration 002: operator preflight and hold

**Status: REVIEW / HOLD.** This is an operator checklist, not an automatic
migration, production approval, deployment or permission to write real data.
The application feature `ADMIN_ENABLE_TENANT_CRM_CONTACT_CREATE` stays
**false**. Do not use this procedure on the live PIVNIK database or a
shared Admin/legacy database. PR #371 remains Draft until CHAT01 integration.

## Object of review

- Exact file: `admin-platform/tenant-migrations/002_manual_crm_contacts.sql`.
  Review its bytes and SHA-256 in the **approved, merged** release revision;
  do not use whichever branch happened to be checked out.
- The only expected DDL: `spaceverse_crm_contacts` and
  `spaceverse_crm_contact_create_requests`, their constraints and two
  per-scope active-channel unique indexes. No `users`, `wallets`,
  `user_identities`, client balances or backfill.
- Dependency order on the **same isolated target database**:
  `migrations/017_spaceverse_runtime_binding.sql`,
  `018_spaceverse_runtime_scope_binding.sql`,
  `019_spaceverse_customer_ownership.sql`.
- SQL guard `spaceverse.crm_contacts_migration='approved'` prevents accidental
  execution but is **not an authorization system**. No startup/CI automatic
  step should set it.

## Step A: independent evidence, no mutation

1. The coordinator selects an exact approved company, venue, prepared
   onboarding draft and runtime manifest **from current Admin metadata**.
   Confirm the signed, active owner principal and its current company grant.
   Record the canonical `draftId`, `runtimeKey`, `companyId`, `venueId`,
   `manifestSha256` and positive `manifestRevision`. Never take scope
   from browser form fields, URL query parameters or an arbitrary caller.
2. Inspect the **protected** `ADMIN_ONBOARDING_DATABASE_REGISTRY_JSON` entry
   for that runtime key and the referenced
   `SPACEVERSE_TENANT_DATABASE_URL_*` variable. Validate isolation using
   the existing `onboardingTargetRegistry.validate()`: the host/port/database
   must not resolve to `ADMIN_DATABASE_URL`, `ADMIN_READ_DATABASE_URL`,
   `ADMIN_PRODUCTION_WRITE_DATABASE_URL`, `DATABASE_URL` or another tenant.
   Do not print the connection URL, tokens, credentials or their hashes.
   Make a separate operator-controlled record of the approved database name.
3. Use a **read-only connection to that registry-resolved target**, ideally
   a transaction `BEGIN READ ONLY` with restricted privileges. Call
   `inspectManualCrmMigrationTarget(target, expected)` from
   `admin-platform/server/tenant-crm-manual-migration-preflight.ts`, where
   `expected` is the verified canonical manifest and database name from
   steps 1–2. The module has only two SELECT statements and makes no
   credential or approval decisions. Never fabricate the expected values
   from the inspected target itself.
4. Require `state:'review_required'` and `approvalGranted:false`. The
   preflight rejects: incorrect database/schema, incomplete 017–019 base,
   missing/ambiguous binding, mismatch in runtime/manifest revision/hash or
   company/venue, status other than `prepared`, or existing/partial 002
   tables. **Any refusal means STOP**: do not retry with loosened checks,
   auto-repair, backfill, migrate or enable CRM.
5. Capture a secured rollback-capable database snapshot/backup reference,
   current schema inventory, exact SQL checksum, current owner approval,
   migration execution window and recovery owner. This requires separate
   operator assessment of volumes, dependencies, API consumers and rollback.
   If backup/ownership cannot be proved, STOP.

## Step B: explicit owner/coordinator approval (not granted here)

The owner and CHAT01 coordinator must authorize in writing **the exact
dedicated database identity, company/venue/draft/runtime, migration checksum,
backup/recovery plan, execution window and operator**. No approval is implied
by green CI, `review_required`, possession of credentials or a saved key.
Before applying, re-run Steps A. A changed manifest, grant, registry entry,
database name or schema voids the approval.

Only after that separate approval, the operator may execute the reviewed
migration 002 within its existing BEGIN/COMMIT, deliberately opting into its
`spaceverse.crm_contacts_migration` guard in the same database session.
Use strict SQL error handling and **never** run the Admin migration runner,
startup bootstrap, `materialize`, or tenant-wide migrations as a substitute.

## Step C: post-application verification (separately authorized)

On the same database only, inspect the existence and exact definitions of
both new tables, foreign keys, unique indexes and the (runtime,company,venue)
constraints. Verify both tables start empty, do not contain app-user rows,
and cannot be accessed from another company/venue. Compare pre/post counts
and checksums of existing `users`, `wallets` and ownership. Do not change
their data to make a test pass. If any check fails, leave the contact feature
OFF, preserve forensic evidence, and invoke the approved backup/rollback
decision; there is **no automatic destructive DROP** in this runbook.

The separate HTTP/PG16 synthetic tests and desktop/mobile browser tests
must still pass on the **final integrated release head**. Real owner/tenant
permission and live E2E remain independently gated. Merge and deployment
require a new coordinator decision; migration success alone does not confer
venue `active` or commercial readiness.

## Automated safety evidence

`inspectManualCrmMigrationTarget` is a **read-only library**, not a
command that opens a production database. Its isolated Vitest coverage
asserts successful exact-scope inspection without a single write and
fail-closed cases for foreign database, wrong manifest, incorrect scope,
missing prerequisite/binding, already-present tables and invalid input.
It does not validate registry credentials or real owner grants; those remain
separate operator checks.
