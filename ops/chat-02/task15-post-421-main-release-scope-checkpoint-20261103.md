# CHAT 02 · task 15 · post-#421 main integration scope and release checkpoint

Date: 2026-11-03. **IN PROGRESS / POLICY_REVIEW_REQUIRED / NO CHAT-02 MERGE OR DEPLOY.**
This is one read-only evidence handoff, not a change to RBAC policy, a production release approval or a claim of live E2E.

## New fact since the previous checkpoint

- GitHub `main` advanced from `25aa92dbaf32f82bbee7d32e14f0a56620e0c4e7` to **`a0bf63762c0126c34329b46f88071f51f3122fc6`** when commercial integration [#421](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/421) was merged on 2026-11-02 23:26 UTC. This is a **main merge**, not approval or merge of CHAT 02's task-15 Draft stack.
- GitHub blob comparison on exact refs: `admin-platform/server/tenant.ts` and `admin-platform/server/onboarding-access.ts` are **byte-identical** between current main and task-15 [#420](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/420). `admin-platform/server/router.ts` **differs**, so #420's earlier green signed HTTP suite cannot certify the newly merged main router in combination with the unmerged task-15 tests.
- New default-off manual CRM contact POST in main (`/api/admin/onboarding/drafts/:draftId/crm/contacts`) uses signed session, CSRF, canonical prepared draft and a current **owner-only** gate; a manager invitation alone is insufficient. The new route has separate signed HTTP/native PostgreSQL tests in #421. This is not evidence that all legacy Admin trusted-director resources are venue-scoped.
- #421 exact-head PR CI had eight completed-success workflows, but this does **not** constitute task-15 stacked-chain acceptance against new main. Previous [#420](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/420) exact-head CI was 4/4 success on its earlier base; [#422](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/422) docs-only exact-head release gate was success. Neither is live E2E. Independent submitted reviews on #378/#420/#422 remain absent at this checkpoint.

## Read-only production observation, not an action

Railway project `content-nature`, production, was inspected **read-only** after #421 merged:
- `pivnik-bonus-app` and `pivnik-vk-test` show SUCCESS deployments for main `a0bf63762c0126c34329b46f88071f51f3122fc6`, created 2026-11-02 23:26 UTC.
- `admin-pilot` first deployment of that SHA FAILED; a redeploy for the same SHA was BUILDING when inspected (created 23:36 UTC). Its final result was **not verified**.
- These are Railway-reported deployment states, **not** proof of endpoint health, tenant authorization correctness or live E2E. No production write, deploy, rollback, environment change or secret read was performed by CHAT 02.

## Do not break / coordination

- Preserve the existing legacy `trusted` company-level resource/method permissions in `tenant.ts` until the owner/CHAT 01 explicitly chooses **A** (accept legacy company-wide access) or **B** (approve separately specified venue RBAC change) in [#378](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/378). Prepared onboarding invitation scope remains distinct.
- Do not overwrite CHAT 01 [#385](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/385), CHAT 03/04 branches or the merged #421. No changes to `server.js`, `universal-server.js`, runtime routes, migrations, tests, secrets, kiosk, patch chain, or production.
- Installed `pivnik-preflight` and references were not exposed by the skill registry; GitHub/Library/module-map and read-only Railway checks are **partial preflight only**. No local checkout; local materialization, Node, check, audit and live E2E were **not run**.

## Checkpoint and exact next step

**Task 15 stays IN PROGRESS; do not advance to 16.** This branch is a standalone docs-only checkpoint based on `main@a0bf63762c0126c34329b46f88071f51f3122fc6`; its own SHA and CI must be recorded in the Draft PR. CHAT 01 should (1) acknowledge the observed post-merge production state, especially admin-pilot's final status, without treating Railway status as acceptance; (2) record a written A/B decision and named approver in #378; (3) arrange independent review and rerun the task-15 signed HTTP/PostgreSQL regression stack against current main/router in a separately reviewed integration branch. Do not merge/deploy CHAT 02 until those gates are met.
