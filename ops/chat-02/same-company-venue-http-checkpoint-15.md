# CHAT 02 — checkpoint #15: signed HTTP sibling-venue isolation

Date: 2026-11-01. Status: **IN PROGRESS**. Exactly one isolated, test-only step; no integration authorization.

## Confirmed predecessor
- Task #14: Draft PR #366, test-only cross-company CRM HTTP mutation denial, CI reported success at its exact head.
- Task #15 first slice: Draft PR #372, HEAD `d62d7cd9c896dc4519827408add30735da841b1e`; PGlite onboarding predicate 5/5, release gate 41273940747 completed/success. That is **not** signed HTTP or native PostgreSQL proof for this new slice.
- Current `main` at preflight: `c92ed7cd65f1a96d94363c2b7e212424ab078a73`. No competing completed #15 PR found. CHAT 01 #363 remains a Draft COMMERCIAL NO-GO; CHAT 03 and other work remain separate.

## This isolated step
- Branch: `test/chat02-venue-http-scope-20261101` (based on the confirmed main SHA).
- Test commit: `c4e1d32454264949e3cff044ee8e7ae45d106101`.
- Draft PR: [#375](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/375).
- Added only `admin-platform/server/tests/chat02-same-company-venue-http.spec.ts`. Uses actual signed Admin HTTP router, CSRF/Origin, canonical same-company fixture with distinct venue IDs, and a disposable PGlite database by default. It tests invited venue manager 12 vs company owner 11, sibling read/write denial, revocation/downgrade, and unsigned requests.
- Native mode is opt-in via the **existing** guarded loopback `SPACEVERSE_TEST_NATIVE_POSTGRES_URL` fixture; native results are **not yet verified**.
- No changes to `server.js`/`universal-server.js` or their duplicated routes. No production SQL/data/config/secrets, kiosk, patch chain, force push, merge, or deploy.

## Preflight and tests
- Installed skill registry returned no `pivnik-preflight`; skill references could not be loaded. Reviewed `ops/MODULE-MAP.md` Do not break and existing Admin route/fixture implementations directly.
- Local `git ls-remote` failed DNS resolution of github.com; local checkout/dependencies unavailable. Focused Vitest, `npm run materialize` twice, `node --test`, `npm run check`, `npm audit` **NOT RUN locally**.
- Exact-head GitHub CI **pending independent verification** at checkpoint creation. No live E2E or native PostgreSQL success claim. CI for another workflow is not evidence for this file.
- No Railway writes. Read-only Railway not required for this isolated synthetic test.

## Blockers / next exact step
1. Inspect exact-head GitHub CI for PR #375 and verify the new file's three signed HTTP cases actually executed. If red, repair **only** this isolated test in its branch; never broaden runtime scope.
2. Run the same test with an independently provisioned loopback `crm_fixture` PostgreSQL cluster and record exact command, count, and result; do not use production DB.
3. Review #372 + #375 together with CHAT 01 coordinator before marking #15 complete. Remain on #15, **do not start #16** until signed HTTP and native evidence are verified.
