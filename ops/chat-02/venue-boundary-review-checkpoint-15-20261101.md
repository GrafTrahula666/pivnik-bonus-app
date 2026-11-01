# CHAT 02 · #15 · company-wide legacy vs invited-venue authorization boundary

Date: 2026-11-01. Status: **IN PROGRESS / POLICY REVIEW REQUIRED**. One docs-only review slice, not a security fix or release approval.

## Confirmed checkpoint and scope

- Task #15 follows completed cross-company #14; do not advance to #16 until #15 is reviewed.
- Reviewed `main@c92ed7cd65f1a96d94363c2b7e212424ab078a73`, `ops/MODULE-MAP.md` ("Do not break"), open Draft #372 (PGlite predicate), #375 (signed HTTP), CHAT 01 Draft #363 (commercial NO-GO), and other parallel Draft branches.
- PR #375 now has a **newer independent commit** `89197f3b8335db25909593ae0fc6ac9792556540` adding a fourth signed HTTP negative case for URL/body company/venue/tenant substitution. Do not duplicate or overwrite it.
- No other completed #15 PR found at review. This document records the *policy boundary*, without touching the existing tests or concurrent branches.
- Installed `pivnik-preflight` and references are not exposed by the available skill registry; repository inspection and the module map were used instead. Local `git ls-remote` cannot resolve github.com, so no local checkout.

## Code-backed authorization distinction

| Surface | Server source and decision | Same-company sibling venue |
| --- | --- | --- |
| Active legacy Admin `GET /api/admin/venues` and `/api/admin/venues/:venueId/*` | `admin-platform/server/tenant.ts`: `listAuthorizedVenues` and `buildVenueScopeQuery` use `admin_company_access` company membership; `requireVenueAccess` distinguishes `owner` and `trusted` **by resource/method**, not invitation venue | A company owner sees both. A trusted director can also list both and read permitted resources at both. This is **existing company-wide policy**, not venue-invitation isolation. |
| Onboarding draft GET/POST and support | `admin-platform/server/onboarding-access.ts`: `onboardingDraftAccessSql` requires the exact draft/venue invitation or a company-wide **owner** grant. `trusted` company grant alone does not satisfy it. `lockOnboardingDraftAccess` rechecks/locks current grants for mutations. `onboarding-support.ts` resolves canonical scope and writes an enumerated ticket in a transaction. | Invited manager can read/write own draft; sibling draft is denied; downgrade/revocation is enforced on the same signed session. Company owner retains both. |
| Onboarding support HTTP transport | `admin-platform/server/router.ts` rejects URL query scope overrides; `onboarding-support.ts` rejects unexpected body fields and derives company/venue from canonical draft scope | Wrong venue, `companyId`, `venueId`, `tenantId` substitution cannot create a sibling ticket in the tested fixture. |

**Boundary / decision for CHAT 01:** Task #15's requirement, "company rights must not accidentally expand venue rights", is demonstrated for the *onboarding invitation* surface only. It is **not** a universal per-venue restriction for legacy Admin active-venue routes: a trusted company director intentionally has company-wide reads on allowed resources. Narrowing that legacy access without an explicit product/RBAC decision would revoke existing second-director capabilities and violate Do not break. Do not label the legacy behavior a newly proven exploit or silently change `tenant.ts`.

## Evidence, not inferred live coverage

- [Draft #372](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/372): same-company onboarding SQL predicate, 5/5 PGlite; [release gate 41273940747](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41273940747) success on its exact head.
- [Draft #375](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/375) exact HEAD `89197f3b8335db25909593ae0fc6ac9792556540`: [native PostgreSQL 41279486662](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41279486662) completed/success, **4/4 new signed HTTP tests**, 29/29 existing bootstrap tests; [release gate 41279486532](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41279486532) completed/success, root 606/606, Business **649 passed / 90 skipped**, including 4/4 new PGlite signed HTTP tests. Logs inspected on this exact head.
- The release gate's materialization/idempotency, syntax/check, package and high-threshold audit steps succeeded. Moderate dependency advisories remain. Native tests used disposable PostgreSQL 16 and synthetic fixture, **not production/live venue E2E**.
- **This docs-only branch has no new tests run locally**. Its exact-head CI must be checked separately; prior green PRs do not automatically prove this new SHA. No Railway access needed for this code-reading slice.

## Safe checkpoint / next exact step

- Branch: `audit/chat02-venue-boundary-review-15-20261101` from `main@c92ed7cd65f1a96d94363c2b7e212424ab078a73`; commit SHA and Draft PR URL are recorded in the PR description after creation.
- Changed file: only this Markdown audit/checkpoint. No runtime routes, SQL, test fixtures, workflows, signing, secrets, production data, kiosk, patch-chain, merge or deploy.
- Blocker: CHAT 01 must explicitly decide whether company-wide trusted director access to **legacy active venue routes** is intended for multiple venues, or whether a future separately approved per-venue grant is required. No automatic RBAC migration or tightening.
- **Next precise step:** coordinator reviews #372 + #375 plus this policy matrix, confirms which surface #15 is intended to cover, and identifies one concrete missing route/case if any. If a gap is confirmed, continue #15 with only that isolated negative regression in a new Draft PR. Otherwise mark #15 evidence complete for coordinator review; do not begin #16 in this run.
- Handoff is this separate Draft PR's description; no direct edits to CHAT 01 or other agents' branches.
