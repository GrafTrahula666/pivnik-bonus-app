# SPACEVERSE / CHAT 01 — task 07: standard integration checkpoint format

**Evidence snapshot:** 2026-11-01 (UTC), based on GitHub main c92ed7cd65f1a96d94363c2b7e212424ab078a73. **Mode:** documentation in a new isolated Draft PR. **Purpose:** one deterministic, reviewable vocabulary so CHAT01–CHAT14 and release integrators never confuse a written feature with a merged, enabled, deployed or independently verified feature.

**Previous:** [CHAT01-06 / Draft #350](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/350), [CHAT01-05 / Draft #347](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/347). **Next:** CHAT01-08 (testable CI and release checklist). This document does not reassign any workstream ownership, start a new automation, perform a merge or configure a technical release mutex.

## 1. Authoritative state dimensions

**Never use an undifferentiated "готово", a single percentage, or a green dot as a release claim.** Every checkpoint contains independent evidence for the following dimensions.

| Dimension | Valid values | Source of truth | What it does NOT prove |
| --- | --- | --- | --- |
| Change implementation | NOT_STARTED / IN_PROGRESS / WRITTEN / REVIEWED / BLOCKED | exact GitHub branch, file diff and commit SHA | tests, merge or live availability |
| Tests | NOT_RUN / RUNNING / PASS / FAIL / BLOCKED / NOT_APPLICABLE | run URL, full SHA, named suite and outcome | production permissions or deployment |
| Review | NOT_REQUESTED / PENDING / APPROVED / REJECTED / STALE | required review metadata linked to current head | passing checks, safe deploy |
| Integration | NOT_MERGED / MERGED / REVERTED / BLOCKED | resulting merge commit contained in current main | service deployed that SHA |
| Feature enablement | UNKNOWN / DISABLED / ENABLED / NOT_APPLICABLE | effective runtime settings and authoritative entitlement for specified scope | healthy service or business functionality |
| Railway deployment (per service) | NOT_OBSERVED / QUEUED / BUILDING / DEPLOYING / SUCCESS / FAILED / SKIPPED / ROLLED_BACK / BLOCKED | project, environment, service, deployment ID, commit SHA and timestamp | live authenticated end-to-end user experience |
| Live E2E (per scenario) | NOT_RUN / PASS / FAIL / BLOCKED / NOT_APPLICABLE | time-stamped on-actual-target result, scope, request/response evidence without secrets | other tenant/device/platform scenarios |
| Release decision | NO_GO / HOLD / GO | named authorized decision-maker and explicit gate-by-gate justification | an automatic deployment or lasting approval |

**UNKNOWN != ENABLED; DISABLED != UNKNOWN; SKIPPED != SUCCESS; CI PASS != E2E PASS; MERGED != DEPLOYED.** Record an unknown value explicitly as UNKNOWN, not a blank, true or zero. A 0 ₽ value is financial data and may mean a confirmed real zero, not an absent source. Use NOT_APPLICABLE only with a reason.

Separate feature readiness by **tenant/company, venue, platform, service and environment**, when applicable. Never roll up a root-PIVNIK green test as a green independent-customer SaaS test.

### Frozen source identifiers

Every factual test or rollout claim must attach its exact full 40-character SHA. Include both PR head SHA and merge SHA if merged; don't assume GitHub PR head equals the final merge commit or that different Railway services have the same deployed SHA. A new push makes prior-head CI and approvals potentially stale. Timestamp in ISO-8601 UTC; if unknown, use UNKNOWN and say why.

## 2. Required checkpoint record

The following is a **copyable Markdown template**. Replace placeholders before using it; do not commit or publish secrets, bearer/session tokens, real users' PII, provider authorization codes, raw DB connection strings, debug signing keystores or private business data.

> **Checkpoint ID:** CHATnn-itemnnn-YYYYMMDDTHHMMSSZ  
> **Workstream / accountable agent:** CHATnn / name or UNKNOWN  
> **Task & scope:** concise in-scope feature, non-goals, related exact API contract  
> **Status & decision:** IN_PROGRESS or documented conclusion; RELEASE = NO_GO | HOLD | GO  
> **Checked at UTC / evidence freshness:** timestamp; any stale evidence  
> **Mode/authority:** READ_ONLY | ISOLATED_DRAFT | EXPLICITLY_APPROVED_MERGE | EXPLICITLY_APPROVED_DEPLOY (include approval evidence if applicable)  
> **Origin repo / source baseline:** GrafTrahula666/pivnik-bonus-app; base main full SHA and checked timestamp  
> **Origin branches inspected:** list branch + HEAD, including relevant already-merged equivalents  
> **Own branch / PR:** exact branch, PR URL, Draft status, current head full SHA, changed-file list  
> **Implementation:** NOT_STARTED | IN_PROGRESS | WRITTEN | REVIEWED | BLOCKED; evidence path/line/test  
> **Review:** NOT_REQUESTED | PENDING | APPROVED | REJECTED | STALE; exact review and required protections  
> **Merge:** NOT_MERGED | MERGED | REVERTED | BLOCKED; merge SHA, integrated main SHA and date if actually merged  
> **Compatibility:** producers/consumers, affected tenants and service origins, path intersections, duplicate server parity, migrations, POS/ledger and kiosk considerations  
> **Tests on current head:** one row per exact command/suite; status, full SHA, run link/output and failing stage; explicit NOT_RUN if unavailable  
> **Main release CI:** exact main SHA, required status check name, status, run URL, failure cause, which steps were skipped  
> **Environment/config:** effective scope, source of setting, flag/entitlement ENABLED | DISABLED | UNKNOWN; NEVER infer from variable name alone  
> **Railway:** one row per affected service: project/env/service ID; deployment ID, status, deployed full SHA, observed at UTC, rollback capability *as metadata only*  
> **Live E2E:** one row per required business scenario; actual environment and principal scope, PASS/FAIL/BLOCKED/NOT_RUN, link/reference and time (no secrets)  
> **Dependencies:** other workstreams and PRs; upstream blocker, downstream consumers, possible conflict + reviewer  
> **Release lock:** release ID, current owner, acquired/expires UTC, current candidate; set NOT_ACQUIRED until really established, do not invent one  
> **Risk:** P0/P1/P2/P3, specific failure mode and affected users/data, mitigation and rollback limit  
> **Backup/rollback:** actual backup reference and restore-test evidence or NOT_VERIFIED; known-good deployment IDs; destructive migration = HOLD  
> **Personally done this run:** actions actually performed, exact writes; distinguish other agents' work  
> **Not done / blockers:** explicit list of tests/deploy/validation not completed and concrete reason  
> **Next smallest action:** exactly one task ID and owner, allowed mode, preconditions; STOP rather than begin next queue item while previous work is open  
> **Final sign-off:** reviewer + owner + decision timestamp, or NOT_APPROVED  

### Per-test evidence table (repeat as needed)

| Kind | Exact commit SHA | Command / scenario | Status | Proof URL / digest / timestamp | Limits |
| --- | --- | --- | --- | --- | --- |
| local/CI/native PostgreSQL/browser/mobile | FULL_SHA | exact command or scenario | NOT_RUN / RUNNING / PASS / FAIL / BLOCKED / NOT_APPLICABLE | output or run id, NEVER invented | provider/tenant/deployment not tested |

### Per-service deployment table (repeat as needed)

| Service and environment | Intended SHA | Actual deployed SHA | Deployment ID | Status and observed UTC | Rollback capability | E2E status |
| --- | --- | --- | --- | --- | --- | --- |
| guest Telegram / VK / SPACEVERSE Admin | FULL_SHA or UNKNOWN | FULL_SHA or UNKNOWN | ID or UNKNOWN | provider status + timestamp | true/false/UNKNOWN **metadata only** | NOT_RUN/PASS/FAIL/BLOCKED |

**Status transitions:** task owner may mark WRITTEN after committing code, PASS only after reading exact-head test evidence, MERGED only with actual resulting main SHA, and DEPLOYED only after reading relevant service deployment ID+SHA. LIVE E2E requires an actual authorized business scenario. Changes in main, PR head, CI, env, role grants, API consumer or deployment require refreshing the affected sections; older PASS can become STALE. GO is a separate, narrowly scoped owner decision after all critical gates.

## 3. Cross-chat reporting contract

1. Each agent writes a **single latest checkpoint for its own numbered task** and references the previous accepted checkpoint, GitHub PR and full SHA. Prefer task-specific ops document or current workstream progress file. Never assert that CHAT01 or a different agent merged it.
2. For each run, first compare current main and origin PR head, inspect MODULE-MAP.md Do-not-break, open relevant PRs, CI and deployments when material. A checkpoint is an **evidence report**, not a lock and not a substitute for repository permissions.
3. Distinguish facts personally checked from claims reported in another PR body. A test mentioned in a PR description but not inspected is REPORTED, not VERIFIED. Links and exact SHA are required.
4. Declare non-overlap and conflicts at **file and API** levels. Example: CHAT08 Dashboard and CHAT09 server read models have a producer/consumer dependency without shared-file changes. Reconciliation of MODULE-MAP is required where CHATS 01/04/09 edit it; never silently replace the whole file.
5. Do not progress an unfinished numbered item into the next one merely because another agent is working in parallel. On collision, pause and name an integration reviewer; do not execute another agent's work.
6. P0 protections remain: tenant isolation, signed owner/store proof, cash/POS locks, Android kiosk signing key with 2–3 verified independent backups. No one unilaterally auto-merges or deploys a Draft PR to real kiosk/production.
7. The release coordinator holds **NO_GO/HOLD** until the required main CI, exact SHA for all targeted services, authorized scope/tenant E2E and approval are independently evidenced. A human/agent release lock is not currently implemented by this Markdown file.

## 4. Filled read-only example at snapshot (not a release approval)

This example is derived from **actual reads in this CHAT01-07 audit**, not a claim that new code was integrated. Recheck before any later decision.

| Field | Evidence 2026-11-01 |
| --- | --- |
| Repo main | c92ed7cd65f1a96d94363c2b7e212424ab078a73 |
| Open PRs at search | 82; count is time-dependent |
| This task | CHAT01-07, implementation = WRITTEN **only for this documentation standard** after its commit; integration = NOT_MERGED; no production release authority |
| Previous task | [CHAT01-06 Draft #350](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/350), head db9a4333fa0c12381888d632bf5006eb83334df1; Draft and OPEN at check |
| Required main CI | Pivnik release gate [run 41257568138](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41257568138): **FAILURE**, Railway GraphQL Not Authorized in read-only secret check. Does not prove secret is missing |
| VK parity main | [run 41257568169](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41257568169): SUCCESS, not a replacement for required main gate |
| Telegram production | Railway **pivnik-bonus-app** deployment **19d17252-3c93-4e10-82d1-38126d08263a**: SUCCESS, deployed c92ed7cd65f1a96d94363c2b7e212424ab078a73, canRollback=true as provider metadata. LIVE_E2E=NOT_RUN here |
| VK production | Railway **pivnik-vk-test** deployment **d34c69f1-56d6-41e6-9955-eba8afab32c4**: SUCCESS, deployed c92ed7cd65f1a96d94363c2b7e212424ab078a73, canRollback=true metadata. LIVE_E2E=NOT_RUN here |
| Admin production | Railway **admin-pilot** last successful **02b2d42e-1c48-4822-930d-158fb30ce510** deployed **febca6ae6ce7be85a53eaf0e4a38fe1f087385ff**; main c92ed7cd deploy **09b8219f-6e55-4406-8c64-71d499096956 SKIPPED**. LIVE_E2E=NOT_RUN here |
| Concurrent work | [CHAT04 #349](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/349) newly edits ops/MODULE-MAP.md, as do [CHAT09 #344](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/344), [#348](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/348) and [CHAT01 #346](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/346). No files merged into main by this task |
| Feature enablement | UNKNOWN without reading effective production flags/entitlements; variable names and repository defaults are insufficient |
| Tests in this task | No local materialize x2, node --test, npm run check, npm audit, native PostgreSQL, browser/mobile, device or production E2E. Not run; no contrary assertion |
| Integration lock | NOT_ACQUIRED; no actual runtime lock or merge/deploy operations |
| Commercial SaaS release | **NO_GO**, required CI and external owner/licensing/tenant acceptance gates not met |

**Snapshot limits:** GitHub API and Railway connector read-only metadata, not a local checkout or a fresh execution of the service tests. Deployed success is a Railway status, not a verified functional health test by this task. This document is a template and an illustrative record only; the repository currently does not enforce this reporting format in CI or agent automations.

## 5. Task completion / handoff

- **CHAT01-07:** done **as an authored documentation artifact in its own Draft branch**, pending its own PR creation; no runtime code/configuration/CI or production/DB changes.
- **Proof required before any merge:** fresh main, code review, exact-head gate, one integration owner and explicit production-deploy authorization, per CHAT01-06. In particular even a documentation merge to main can trigger Railway.
- **Next numbered task ONLY:** **CHAT01-08**, build a verifiable CI/release checklist, compare the actually configured jobs and required status checks, list missing checks with owners. Do not implement unrelated CI policy changes without explicit approval.