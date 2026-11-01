# SPACEVERSE / CHAT 01 — task 05: shared file and API contract ownership

**Evidence snapshot:** 2026-11-01 UTC; GitHub main at **c92ed7cd65f1a96d94363c2b7e212424ab078a73**. Open PR search returned **78** results at inspection. This is an isolated documentation-only coordination task, not an approved merge, deployment or production operation.

Previous checkpoints: [01 #325](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/325), [02 #337](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/337), [03 #342](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/342), [04 #346](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/346).

## The meaning of ownership

"Owner" in this document means **the Chat/workstream that currently authors the named Draft PR**, based on its GitHub title, description, file list and source calls. It is *not* an automatically enforced GitHub CODEOWNERS assignment, exclusive repository permission, or authority to merge. The exact path .github/CODEOWNERS was **not found** on pinned main; other possible locations were not checked.

An [active Main Protection ruleset](https://github.com/GrafTrahula666/pivnik-bonus-app/rules/25152486) declares **one approving review** and required status context **Syntax, tests and dependency audit**, with code-owner review disabled. The exact scope/application of these rules must be checked again at merge time. No repository policy changed in CHAT01-05.

## Exact shared-file intersections (GitHub file lists)

| File / intersection | Responsible Drafts | Verified overlap and non-negotiable decision |
| --- | --- | --- |
| **ops/MODULE-MAP.md** | CHAT09 [#344](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/344) and CHAT01 [#346](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/346) | Both change the same file from main c92ed7cd. #344 records time-series v1, #346 corrects ten gateway/Express user-action overlaps and stale CI baseline. **Integrate both sets of edits**, not whole-file overwrite. Line-level Git conflict has not been computed. |
| **package.json** | Legacy [#96](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/96), kiosk [#165](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/165), marketing CHAT13 [#336](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/336) | Exact file overlap. Broad old branches are hundreds of commits behind main; cannot transfer the entire package or prestart scripts. Compare only intended manifest changes and lockfile consistency on a fresh main. |
| **authorization-membership.js, authorization-middleware.js, two authorization tests** | Legacy #96 and CHAT02 [#339](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/339) | Four shared code/test paths. CHAT02's narrow carve-out is a candidate; do not import the same helpers twice from #96. Require negative tenant/venue/user access tests and proof of runtime consumers before declaring the vulnerability closed. |
| **universal-server.js** | Legacy #96 and kiosk #165 | Both old Drafts change the gateway; neither is merge-ready. Any future shift/auth edit requires inspection of gateway, Express dual routes and production signing continuity, not a large rebase. |
| **admin-platform/server/writes.ts** | CHAT10 [#333](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/333) | No exact current CHAT08/09 file overlap, but an authoritative source for loyalty configuration. Keep tenant-specific not-configured versus explicit zero; no changes to guest POS bonus writers under this PR. |
| **admin-platform/server/data.ts, evotor-read.ts, time-series.ts** | CHAT09 #344 | Server read contract. CHAT08 does not change the same files but consumes its responses. Preserve all existing fields and explicit unknown/empty semantics. |
| **ProductionDashboard.tsx, CashDashboard.tsx, cash-panel.css** | CHAT08 [#343](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/343) | UI and UI test contracts; no backend edits. Consumer is not evidence of fiscal cash validity. |
| **VenueOnboarding.tsx / wizard E2E** | CHAT04 [#340](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/340) | UI navigation changes. The complementary CHAT04 [#345](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/345) changes only CRM preparation tests and checkpoint, with **no exact file overlap**. Still one onboarding owner/role contract. |
| **.github/workflows/railway-operator.yml** | CHAT11 [#335](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/335) | Isolated CI access diagnosis owned by CHAT11. Not authority to change secret values, disable release gating or run unreviewed operators. |
| **marketing-consent-policy.js, marketing-consent-reader.js, manual SQL** | CHAT13 #336 | Unmounted per-channel consent preparation. It does not modify existing broadcast routes; legal evidence and consent verification are still required before runtime use. |

**Important:** Identical paths prove an integration *overlap*, not a Git conflict at the same line. Distinct paths prove no direct file overlap, **not** API or security compatibility. These classifications are based on GitHub list_pr_changed_filenames on the named PRs at this snapshot.

## Shared API producer → consumer contracts on pinned main

| Authoritative producer | Consumer / API | Owner boundary and required verification |
| --- | --- | --- |
| Admin **router.ts** and **tenant.ts** | All /api/admin/venues/:id/* | Admin session, Origin and CSRF for writes, exact company/venue scope. CHAT02 #339 modifies root authorization helpers, **not** the Admin router: tenant deny tests in both stacks remain necessary. |
| Admin **data.ts:getVenueDashboard** through router.ts lines 582–583 | **ProductionDashboard.tsx** calls /api/admin/venues/:id/dashboard/operations | CHAT09 #344 adds optional hour/day time series; CHAT08 #343 renders existing data. Preserve period, source, totals and existing charts. Check absent hours versus empty hours and Europe/Moscow time boundaries with both candidate heads. |
| Admin **evotor-read.ts:getEvotorReport** through router.ts POS handler lines 573–579 | **CashDashboard.tsx**, validator **cash-report.ts** | Do not mix fiscal POS net cash with application tracked cash. Preserve connection state, all/app/unlinked, period, missing schema and unknown-currency semantics. #343 and #344 need joint API contract/browser verification even without same-file edits. |
| Admin **writes.ts:getManagedLoyalty/saveLoyalty** through router.ts lines 543–544 | **ProductionManagers.tsx** loyalty editor | On current main an unconfigured independent venue returns zero defaults. CHAT10 #333 intends not_configured/null for absent settings and preserves a real configured 0. Check company/venue inheritance and save validation with another tenant; never silently change guest ledger semantics. |
| Admin **venue-onboarding.ts** through router.ts CRM prepare/scope endpoints | **VenueOnboarding.tsx**, owner/manager flows | CHAT04 #340 UI and #345 company ownership test are one business flow. Confirm prepared scope stays inactive, same-company idempotency, foreign ID 403 and absence of automatic activation. |
| Guest **server.js** requireBusinessService and /api/internal/business/* | Admin config PIVNIK_APP_URL and BUSINESS_INTERNAL_TOKEN | Server-to-server only; this bearer-like shared secret is not a normal Admin session. No secret values read or published. Maintain strict recipient scope and separate auth model. |
| Root **universal-server.js** gateway and **server.js** Express child | Guest **app.js**, staff/QR, POS routes | CHAT01 #346 documents **ten** overlapping method+path user-action handlers. Check both contexts for auth, profile, deletion, consent, leaderboard, PIN, QR and admin list; /api/health is intentionally two different response roles. |
| **pos/bonus.js**, pos HTTP and spaceverse-pos runtime | Guest balances, kiosk and fiscal reporting | Protected financial authority, idempotent writes and source-of-truth amounts. Never repurpose dashboard metrics as authoritative POS settlement; kiosk signing/migrations remain separate P0 review. |

The above source relationships were checked in pinned GitHub files: admin-platform/server/router.ts, tenant.ts, data.ts, evotor-read.ts, writes.ts, config.ts, src/phaseC/{ProductionDashboard,CashDashboard,VenueOnboarding}.tsx, src/phaseC/cash-report.ts, root server.js/universal-server.js and package.json. **No HTTP request to production was used to prove a live contract.**

## Workstream ownership register (informational, not GitHub roles)

| Chat | Open relevant Drafts in inspected set | Domain owned in current task |
| --- | --- | --- |
| 01 release coordinator | #325, #337, #342, #346; this checkpoint | Release evidence, integration audit, approvals |
| 02 tenant/RBAC | #326, #339 | Root auth helper isolation; broader Admin security needs independent proof |
| 03 CRM | No new CHAT03 PR established by this inspection; historic #96 contains mixed Customer360 | Avoid inventing current completed work |
| 04 onboarding | #328, #340, #345 | Wizard and owner/company scope |
| 05 Evotor owner/OAuth | #329 (documentation) | Provider proof and store ownership |
| 06 POS/fiscal | #327 (documentation) | Receipt return, net-cash source contract |
| 07 licensing | #330 (documentation) | Pricing/subscription approval and expiry |
| 08 dashboard | #331, #343 | KPI UI, time filters and source description |
| 09 analytics | #332, #344 | Scoped aggregated read models |
| 10 loyalty | #333 | Tenant settings and null-vs-zero semantics |
| 11 reliability | #335 | Railway CI identity/permission diagnosis |
| 12 legal/commercial | #334, #338 | Publisher/contract and approval prerequisites |
| 13 marketing | #336 | Consent proof by channel/tenant; not live send integration |
| 14 AI | #341 (documentation) | Candidate AI policy, not a deployed inference engine |

This is not an exhaustive audit of all 78 PRs. Legacy and seasonal PRs also exist and must be rechecked if the exact future integration touches their paths.

## No-concurrent-merge rules for subsequent task 06

1. **No Draft auto-merge or deployment.** A workstream submits its head and tests; only a designated integrator coordinates a merge on a fresh main, with required review and status check. Ownership of a file is not indefinite.
2. Explicitly reconcile #344 versus #346 MODULE-MAP additions. Do not overwrite an accepted section from the other PR.
3. Treat #96 and #165 as historical source branches, not integration units. Avoid bringing old package scripts, route copies, numbered migrations or a new kiosk signing key into main.
4. Require cross-PR contract tests: #343↔#344 dashboard/analytics; #340↔#345 onboarding/ownership; #333 tenant loyalty/real 0; #339 authorization plus route consumers; #336 future consent delivery.
5. Preserve MODULE-MAP Do-not-break: materialize idempotency, immutable migration 007, QR alias semantics, TG/VK identity, XSS/timeout, broadcast dedup, server odds, bonus limits and VK bundle.
6. [Main Pivnik release gate](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41257568138) is **FAILED** due to Railway GraphQL Not Authorized in read-only secret-check stage, while [VK parity](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41257568169) succeeded. CHAT11 investigates; never bypass the gate.
7. Distinguish merged source, enabled features, actual deployment revision and live owner/provider/phone E2E. Current commercial conclusion is **NO-GO**.

## Checkpoint / evidence limits

- **CHAT01-05:** DONE as documentation/evidence only; not a runtime or release acceptance.
- **Base:** main c92ed7cd65f1a96d94363c2b7e212424ab078a73. **Only file in this branch:** ops/CHAT-01-SHARED-CONTRACT-OWNERSHIP-20261101.md.
- **Personally checked:** main/CI/ruleset, MODULE-MAP Do-not-break, #346 predecessor, GitHub file lists of #96/#165 and #326–#346, candidate metadata/HEADs for working #333/#335/#336/#339/#340/#343/#344/#345, actual source API producers/consumers. .github/CODEOWNERS 404.
- **Not checked:** all open PRs exhaustively, alternate CODEOWNERS locations, shared branch merges/cherry-picks, line-level conflicts, live app/POS/provider contracts, manual migrations, device signing cert or production secrets.
- **Tests not run here:** materialize twice, node --test, npm run check, npm audit, native PostgreSQL, Admin typecheck/build, Playwright or real business E2E. Prior CI metadata is *not* a fresh test run.
- **Risk:** P0 tenant and money authority, kiosk signing; P1 failed required CI; P2 shared file overwrite/semantic mismatch.
- **Next ONLY:** CHAT01-06, formal serial integration order, exclusive merge/deploy window and rollback/runbook, after refreshing main, PR states and CI.
