# CHAT 01 — SPACEVERSE release coordination checkpoint

> Mode: isolated Draft PR, documentation only. No merge, deploy, production
> data writes, secret reads/changes, device operations or runtime edits.
>
> Snapshot: 2026-11-01 UTC. This is evidence of source and deployment
> *state*, not proof of live CRM/Evotor end-to-end readiness.

## Current queue / checkpoint

- **Task ID:** CHAT01-01 (of 10): current baseline.
- **Status:** DONE for the read-only inventory; the release is **NOT GO**.
- **Base branch / SHA:** `main` / `c92ed7cd65f1a96d94363c2b7e212424ab078a73`.
- **Last main commit:** merge #324, seasonal Halloween raffle/ticket/invite
  retirement. [Commit](https://github.com/GrafTrahula666/pivnik-bonus-app/commit/c92ed7cd65f1a96d94363c2b7e212424ab078a73)
- **Open PR inventory:** 56 at snapshot, from GitHub PR search; count is time-dependent.
- **Own branch:** `ops/chat01-release-baseline-20261101`.
- **Own PR:** this documentation-only Draft PR. Record its number in the
  PR description/checkpoint after creation.
- **Next task:** CHAT01-02: build a per-feature CRM matrix with four
  separate columns: implemented, merged, deployed, verified live.
- **Checkpoint format for subsequent iterations:** task ID, main SHA,
  own branch/PR SHA, evidence URLs, executed checks and result,
  blockers, next smallest action. Resume unfinished task, not restart.

## Key GitHub cross-check

| PR | Observed 2026-11-01 state | Notes |
| --- | --- | --- |
| [#96](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/96) | OPEN / Draft / mergeable=false | Tenant isolation; requires conflict/rebase analysis, do not assume ready |
| [#165](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/165) | OPEN / Draft / mergeable=false | Kiosk shifts, do not deploy draft to physical device |
| [#296](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/296) | MERGED 2026-10-29 | CRM database bootstrap |
| [#299](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/299) | MERGED 2026-10-29 | Evotor inbox / CRM pagination / fixes |
| [#302](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/302) | MERGED 2026-10-29 | Read-only Evotor owner verification |
| [#312](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/312) | MERGED 2026-10-29 | Unmounted license policy |

These facts supersede the **2026-10-26** snapshot in
[ops/ADMIN-PILOT-MARKET-PROGRESS.md](https://github.com/GrafTrahula666/pivnik-bonus-app/blob/main/ops/ADMIN-PILOT-MARKET-PROGRESS.md);
that file still describes #296/#299/#302/#312 as Draft. Do not rewrite
another workstream's checkpoint as part of this PR.

## Current main CI (commit c92ed7cd)

- [VK native hosting main parity](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41257568169):
  **SUCCESS**.
- [Pivnik release gate](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41257568138):
  **FAILURE**. Job `Syntax, tests and dependency audit`, step
  `Verify existing production secrets without changing them`, reports
  `Error: Not Authorized` in `scripts/railway-ensure-production-secrets.mjs --check`
  when calling Railway GraphQL. This is an **authorization failure of
  the check**, not proof that production secrets are absent or corrupt.
  No credentials were rotated or inspected.
- [Job evidence](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41257568138/job/124703885113).
- This CI finding is **P1 release-blocking**: don't treat overall release gate
  as green. Diagnose permissions separately; do not bypass or delete the gate.
- GitHub ruleset `PIVNIK — Main Protection.` (ID 25152486) is configured
  as active, with one approving review and required status
  `Syntax, tests and dependency audit`. Direct branch protection GET returned
  HTTP 403 to the integration. Do not infer full effective enforcement from
  the read-only ruleset response alone.

## Railway read-only inventory

Account-linked project `content-nature`, environment `production`:

- Service `pivnik-bonus-app` (ID `d8d26f64-9ac1-4a03-9036-1a60f43c0be6`):
  current SUCCESS/online deployment `19d17252-3c93-4e10-82d1-38126d08263a`,
  SHA **c92ed7cd** (2026-11-01).
- Service `admin-pilot` (ID `bc1722fd-ef21-462a-96b4-519f91eafc31`):
  SHA **c92ed7cd** deploy was **SKIPPED**; most recent SUCCESS in inspected
  deployments is SHA **febca6ae** (2026-10-29, merge #312).
- Thus `main` code, deployed app, and deployed admin may not be the
  *same* revision. This does not prove a functional incompatibility.
- The separate `pivnik-admin-staging` Railway project has successful,
  online staging services at SHA `cb3e7cbb` (2026-08-31).
  It must not be mistaken for current main production.
- No production HTTP/Evotor/VK/TG write scenario was executed;
  no live E2E or secrets/configuration/DB migration state verified.
- Railway state was read through `list_projects`,
  `list_services`, `list_deployments`, and `environment_status`.

## Do not break / integration constraints

Read the actual
[ops/MODULE-MAP.md](https://github.com/GrafTrahula666/pivnik-bonus-app/blob/main/ops/MODULE-MAP.md)
including its `Do not break` section. It preserves:
double-idempotent `materialize`, migration 007 immutability,
QR self/merge alias semantics, admin name HTML escaping,
Telegram timeout, broadcast dedupe, VK/TG identity separation,
server-side wheel odds and money limits, VK bundle parity.
`server.js` and `universal-server.js` have duplicated routes;
verify parity against real origin before any future code change.
Do not retire more than one patch script per PR. Never treat
unmounted Evotor components as a production-ready integration.

## Execution and unresolved proof

- **Personally verified in this iteration:** GitHub main SHA, 56 open PRs,
  six named PR states, main CI job/step and error, active ruleset
  configuration, two relevant Railway project inventories and deployment
  metadata, module map.
- **No local clone available here:** no personal `npm run materialize` ×2,
  `node --test`, `npm run check`, `npm audit`, integration or live
  browser runs. Prior GitHub CI output is third-party evidence, not
  a local run. No source or runtime code was modified.
- **Blockers:** failed main release gate (Railway auth), unresolved draft
  conflicts #96/#165, unverified live CRM/Evotor readiness, absent
  independent live-E2E evidence.
- **Next smallest action:** CHAT01-02 CRM matrix, using current
  origin/main and live read-only evidence, without claiming that
  `MERGED` implies `DEPLOYED` or `LIVE VERIFIED`.
- **Handoff:** only the designated integrator may approve merging a
  dependent PR; no automatic merge/deploy by CHAT01.
