# SPACEVERSE · Chat 04 checkpoint 33 — company idempotency / ownership

Date: 2026-11-01. Task 33 only. Isolated base `origin/main@c92ed7cd65f1a96d94363c2b7e212424ab078a73`.

## Existing behavior verified on current source

- `admin-platform/server/venue-onboarding.ts` stores drafts by `(admin_id,request_key)` and `initial_hash`; changed-body retries yield 409, same-body retries return the existing draft. `prepareScope` opens a DB transaction, locks the authorized draft, checks revisions and existing scope, creates company+venue only once, audits and commits together. New company/venue remain `active=FALSE`, runtime `not_provisioned`. On failures it rolls back.
- `admin-platform/server/onboarding-access.ts` checks non-SUPER_ADMIN company access via owner grant or unrevoked organization-wide onboarding invitation, locks the permission rows during mutations and denies null or foreign companyId. The browser does not authorize ownership.
- Existing tests `venue-onboarding.spec.ts`, `crm-preparation.spec.ts` and `onboarding-invitations.spec.ts` already cover sequential draft/scope retries, concurrent identical preparation for **existing** company, grant/revocation, foreign company restrictions, no access leak and rollback.
- No verified production bug in these paths; changing runtime or SQL preemptively would increase risk. No branch overlap found for `crm-preparation` at this audit.

## Isolated improvement

Added one focused HTTP + disposable DB regression in `admin-platform/server/tests/crm-preparation.spec.ts`:
1. SUPER_ADMIN creates a draft for a new company; two concurrent same-body CRM preparations and an additional replay return identical scope/manifest, with **one** new inactive company, venue, application configuration, scope and audit.
2. A regular network owner with grants to companies 10 and 20 cannot create a new company or bind a foreign company 30; both requests fail 403 and leave counts unchanged.
3. No runtime code, schema, secret, route, grant or production data is modified. The fixture serializes PGlite pool writes as documented, so this is a deterministic HTTP regression, **not proof of native PostgreSQL row-lock concurrency**.

## Verification gate

Written only until exact PR-head CI completes: `Pivnik release gate` runs root double `materialize`, root tests, Business Vitest and audits; independent browser check is triggered for admin-platform changes. No local repository checkout or production DB is available here; tests cannot be claimed as passing before the head's GitHub Actions result is inspected. Extra local `npm run lint`, native PostgreSQL contention and production validation are not established by this checkpoint.

## Handoff

This is Draft-only for Chat 01 integration coordinator. No merge, deployment, schema or prod writes. Task 34 is a distinct future item; do not conflate company ownership (33) with venue ownership (34).
