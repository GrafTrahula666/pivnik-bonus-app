# CHAT 02 — checkpoint #15: two venues within one company

Date: 2026-11-01. Status: **IN PROGRESS, test-only slice; no integration authorization**.

- Previous confirmed checkpoint: #14, Draft PR #366, HEAD `a06ec1d03d1ec60aedc01e2f8249357162f4c8d2`; GitHub release gate 41270375606 completed/success (13 new HTTP/PGlite assertions, 658 Business passed / 90 skipped, 606 root passed). No native PostgreSQL or live CRM E2E claim.
- Base: `main@c92ed7cd65f1a96d94363c2b7e212424ab078a73`.
- Isolated branch: `test/chat02-same-company-venue-grants-20261101`.
- Test commit: `c4adeb4aaa13b1da574f73091cc93aef6392ce93`; subsequent checkpoint-only commit is documented by GitHub PR HEAD.
- Draft PR: see the PR opened from the isolated branch (no merge/deploy).
- Changed test only: `admin-platform/server/tests/chat02-same-company-venue-grants.spec.ts`.
- Target predicate: `onboardingDraftAccessSql` from `admin-platform/server/onboarding-access.ts`, against a disposable PGlite database. Two drafts/venues 101 and 102 share company 10. Venue managers are reciprocal; a venue viewer is read-only; adding a same-company `trusted` grant does not widen onboarding scope; revocation/role downgrade are rechecked. A company `owner` intentionally retains access to both venues.
- Existing behavior/important distinction: legacy `resolveVenueScope` / `requireVenueAccess` use `admin_company_access` and are **company-wide** by design. This test does NOT assert that a company owner is venue-limited, does not change legacy authorization, and does not cover native PG, signed HTTP or new tenant CRM mutations.
- Preflight: installed `pivnik-preflight` skill was requested but not exposed by the current skill registry (empty result); no reference files could be loaded from it. Read current `ops/MODULE-MAP.md` and its Do not break constraints, main, active PRs, CHAT 01 #363 (COMMERCIAL NO-GO), CHAT 03 #359/#371, and CHAT 02 #366/#367. No other #15 PR identified in search.
- Tests at creation: local clone unavailable (GitHub DNS resolution failed); `npm run materialize` twice, `node --test`, `npm run check`, `npm audit` and focused Vitest **NOT RUN locally**. GitHub Actions on the final PR HEAD must be checked independently; skipped live tests are not success.
- No root `server.js` / `universal-server.js` changes, no production data, secrets, SQL migrations, Railway writes, patches, force push, merge or deploy.
- Blockers: no installed preflight skill or local checkout; native PostgreSQL/HTTP venue-grant regression remains unverified. The explicit company-wide legacy access policy must not be silently reinterpreted as per-venue RBAC.

**Next exact step (continue #15):** verify GitHub Actions on this PR's final HEAD, inspect focused Vitest failure if any, fix only this new test in this same branch if necessary; then add an independent signed HTTP/native PostgreSQL regression for venue-scoped onboarding access without editing CHAT 03 routes or widening legacy company grants. Do not advance to #16 until #15 has confirmed evidence and coordinator review.
