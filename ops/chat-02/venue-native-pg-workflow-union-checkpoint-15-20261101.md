# CHAT 02 / task 15: independent native PostgreSQL workflow integration checkpoint

Status: **IN PROGRESS / POLICY_REVIEW_REQUIRED / MAIN_MERGE_HOLD**. This is an independent **documentation-only** risk review, not an integration, merge approval, or production readiness claim. The task remains #15; do not advance to #16.

## Exact source evidence (2026-11-01)

- `origin/main`: `c92ed7cd65f1a96d94363c2b7e212424ab078a73`.
- CHAT 01 combined Draft [#385](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/385) HEAD `754a9dc1e2f96d4a12fb5206d5603f49e76afea9`, based on main: native PostgreSQL workflow runs (1) existing CRM bootstrap, (2) signed same-company venue draft/support HTTP, (3) signed venue progress HTTP. Its exact-head [native PG CI](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41298244442) passed; its five predicate-only tests run separately on PGlite.
- CHAT 02 dependent Draft [#389](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/389) HEAD `b1604931be6c58380ada67af06fd55dcd5b44f53`, based on #388 → #387 → #386 → main: native PostgreSQL workflow runs (1) the same bootstrap, (2) the **new** signed venue manager-to-viewer downgrade/current-revision denial HTTP test. Its exact-head [native PG CI](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41312684727) passed; [release gate](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41312684699) passed. These are disposable/synthetic tests, **not live E2E**.
- GitHub compare `#385 HEAD...#389 HEAD`: **diverged**, 4 commits ahead / 5 behind, merge base main. Both change `.github/workflows/spaceverse-crm-native-postgres.yml`; #389 additionally adds `admin-platform/server/tests/chat02-same-company-venue-progress-viewer-downgrade-http.spec.ts`. Independent reviews of #385, #389 and the authorization policy Draft #378: **none recorded** at this checkpoint.

## One newly identified integration risk

The workflow files contain different `pull_request.paths` entries and **different native PostgreSQL test steps**. Copying either whole workflow over the other would silently lose native CI coverage for the other branch. A green CI result on either source SHA does not prove their combined workflow.

The integration owner (CHAT 01), **not this Draft**, should construct a fresh isolated integration branch that retains the union of both sets of trigger paths and runs **all four** disposable native PostgreSQL steps:
1. `server/tests/onboarding-tenant-bootstrap.spec.ts`
2. `server/tests/chat02-same-company-venue-http.spec.ts`
3. `server/tests/chat02-same-company-venue-progress-http.spec.ts`
4. `server/tests/chat02-same-company-venue-progress-viewer-downgrade-http.spec.ts`

Also retain `chat02-same-company-venue-grants.spec.ts` in Business/PGlite coverage, without incorrectly claiming native PG for it. Do not substitute a stale-revision rejection for a venue/role denial. Verify actual workflow job logs on the **combined exact SHA**, with the release gate, inventory and synthetic browser suites separately. Review the workflow path filters so each changed test triggers the gate.

## Authorization and release blockers

The established onboarding invitation is **venue-scoped**, while existing legacy Admin trusted-director access is **company-wide** subject to resource/method capabilities. See [#378](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/378). This is not resolved by more green tests. CHAT 01 must explicitly approve the intended contract and independently review the dependent chain before task #15 can be accepted. Never silently narrow legacy rights or claim that onboarding proofs cover every Admin route.

No installed `pivnik-preflight` skill/references were exposed by the current skill registry. Read `ops/MODULE-MAP.md` and the attached `CHAT_02.md`. Local git clone and tests were unavailable because `github.com` DNS resolution failed; therefore **local materialize x2, node --test, npm run check, npm audit and live E2E were NOT RUN**. Existing exact-HEAD CI evidence is cited above, not re-attributed to this docs-only branch.

Main release remains on HOLD: independent review, explicit RBAC policy, production deployment gates (including Railway source check suites and CI token authorization), protected window, rollback and live E2E remain unverified. No merge/deploy, production data writes, secrets, force push, server.js/universal-server.js route changes, patch-chain changes or other agent branch edits occurred.

## Checkpoint / next exact step

- Task: **15 IN PROGRESS**
- Branch: `audit/chat02-15-native-pg-workflow-union-20261101`
- Base: `main@c92ed7cd65f1a96d94363c2b7e212424ab078a73`
- Scope: **this Markdown file only**; exact HEAD SHA and Draft PR are recorded in the PR description after creation.
- Tests on this documentation commit: **not yet verified**; predecessor CI does not transfer.
- **Next:** CHAT 01 reviews this concrete workflow union risk and #378 policy; after explicit policy acceptance, the integration owner builds and tests the union on one fresh Draft SHA. CHAT 02 stays on #15 until that acceptance, then proceeds to #16 only on a later run.
