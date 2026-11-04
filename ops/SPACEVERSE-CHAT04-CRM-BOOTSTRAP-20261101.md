# Chat 04 / пункт 37 — изолированный тест CRM bootstrap

- **Baseline:** `origin/main@c92ed7cd65f1a96d94363c2b7e212424ab078a73` (GitHub compare identical on 2026-11-01).
- **Own branch:** `spaceverse/chat04-crm-bootstrap-isolation-37-20261101`.
- **Scoped test commit:** `de12e18d52279e4d10e470211cbc979ca1da3b10`.
- **Owner / reviewer:** Chat 04 → coordinator Chat 01, Draft PR only.

## Проверка существующего решения

Read `ops/MODULE-MAP.md` and the Do not break list; checked open origin PRs and existing `onboarding-tenant-bootstrap.ts`, `onboarding-tenant-bootstrap.spec.ts`, `empty-tenant-fixture.ts` and `ops/SPACEVERSE-EMPTY-DATABASE-RUNBOOK.md`. The bootstrap already exists behind `ADMIN_ENABLE_ONBOARDING_DATABASE_BOOTSTRAP=false`; it uses only the server-side registered dedicated target, empty-database preflight, fixed reviewed migrations, an atomic target transaction, canonical scope, lease/audit ledger and an explicit separate schema readiness check. Existing tests already cover disabled mode, non-empty target rejection, DDL rollback, uncertain confirmation/retry, scope revocation, premature venue activation and signed HTTP denials. Reimplementation is out of scope.

## Минимальный diff

One added **test-only** case in `admin-platform/server/tests/onboarding-tenant-bootstrap.spec.ts`: bootstrap only the second registered target; assert its exact runtime/company/venue binding; assert both sibling targets still have zero public tables and no runtime binding; assert one scoped metadata ledger record and that selected venue stays inactive. This specifically verifies the *isolation* aspect of item 37 without new schema, API, feature flags or production writes.

## Gates and limitations

- At creation: test **written, not yet CI-confirmed**. Check exact-head GitHub Actions release gate (double materialize/idempotency, `node --test` through root tests, `npm run check`, Business Vitest, dependency audits), browser E2E and native PostgreSQL CI. Report actual run IDs and results in this PR, do not infer from prior PRs.
- Local checkout, local `node --test`, `npm run check`, raw `npm audit`, or standalone native bootstrap E2E were **not run** in this connector-only session.
- Disposable PGlite/fixture and existing native inventory workflow do not prove a real external dedicated PostgreSQL bootstrap under simultaneous owners, nor authorize production activation.
- No changes to `server.js` or `universal-server.js`, root runtime, SQL migrations, Railway, secrets, POS, guest data or production. No merge/deploy. Other Chat PRs untouched.

**Next:** after exact-head CI confirmation, mark 37 technically verified for Chat 01 review. Item 38 must remain a separate PR/run.
