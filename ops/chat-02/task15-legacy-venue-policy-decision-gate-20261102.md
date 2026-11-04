# CHAT 02 · task 15 · explicit legacy venue-scope decision gate

Checkpoint: 2026-11-02. **IN PROGRESS / POLICY_REVIEW_REQUIRED / NO MAIN MERGE.**
This is a request for a product/security decision, **not** a policy change, implementation, or release approval.

## Verified evidence at this checkpoint

- Canonical `origin/main`: `25aa92dbaf32f82bbee7d32e14f0a56620e0c4e7`.
- Latest stacked task-15 test Draft [#420](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/420), head `b6bafe2ce6269b317e4f5f7fce516f200a7d871f`: **four completed-success GitHub workflows** ([native PostgreSQL](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41522101281), [release gate](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41522100743), [inventory](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41522100629), [browser](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41522101257)). Synthetic signed HTTP and disposable database evidence only; **no live E2E**.
- [Policy audit Draft #378](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/378) documents the existing exception. At this checkpoint #378 and #420 have **no independent submitted reviews**, and #378 has no written owner/CHAT 01 policy decision.
- `ops/MODULE-MAP.md` Do not break: keep legacy company-wide director behavior unless separately approved; preserve owner rights, root-server route parity, materialization and kiosk/release safeguards.
- CHAT 01's [combined regression Draft #385](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/385) and [commercial integration Draft #421](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/421) are separate work; do not alter their branches. Current main auto-deploy/release safety remains under coordinator HOLD.

## The unresolved policy, in one decision

| Surface | Confirmed current rule | Task-15 implication |
| --- | --- | --- |
| Prepared onboarding drafts, scope, application, support, invitations | `admin-platform/server/onboarding-access.ts` resolves exact invitation/draft/venue grants; company **owner** can see both same-company venues; `trusted` director with only venue-A invitation cannot access venue B | Negative and positive signed HTTP tests in #420 cover this scoped surface |
| Active legacy Admin venue list and `/api/admin/venues/:venueId/*` | `admin-platform/server/tenant.ts` authorizes `trusted` company directors at **company scope** for permitted resource/method combinations, without a per-venue invitation | **Not** evidence of universal per-venue isolation; do not silently tighten or claim a new exploit |

**CHAT 01 / owner must explicitly choose and record one outcome in #378:**

- **A. Preserve existing legacy company-wide trusted-director access.** Confirm this is intentional for all venues of that company, with existing resource/method restrictions. Scope task #15 acceptance to onboarding invitation routes. Require independent review of the stacked tests and the policy exception before closing #15.
- **B. Require venue-specific legacy trusted-director access.** Treat as a separate approved RBAC behavior change: specify exact legacy endpoints and roles, compatible grant storage/migration, trusted-director backward compatibility, negative and positive tests, release/rollback plan. **No runtime implementation or narrowing is authorized by this document.**

Until a signed-off choice and independent review exist, **task #15 stays IN PROGRESS**. Do not advance to #16, do not merge/deploy, do not change live tenant data, secrets, kiosk or either root server.

## Exact next action

Coordinator records **A or B**, named approver and affected legacy route scope in [#378](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/378); an independent reviewer checks #420's dependent chain against current main. For A, document accepted scope and finish #15 after review. For B, specify one minimal separately approved change and test before proceeding. No skipped live test may be counted as a pass.

This file is an isolated decision-gate handoff. Its own GitHub CI result must be evaluated on its **own** commit, independently of #420.
