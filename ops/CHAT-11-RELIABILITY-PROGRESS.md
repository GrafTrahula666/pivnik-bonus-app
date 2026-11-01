# CHAT 11 · Reliability / CI / security · checkpoint

Date: 2026-11-01 (UTC). Owner: CHAT 11 only. Scope: item 101 (GitHub Actions → Railway `Error: Not Authorized`).

## Safety and source baseline

- Mode: isolated documentation-only Draft PR. No merge, deploy, production writes, secret reads/updates, reruns, or real-device actions.
- `origin/main` at initial preflight: `c92ed7cd65f1a96d94363c2b7e212424ab078a73`.
- Read current `ops/MODULE-MAP.md`, especially "Do not break" (main lines 1282–1317).
- Compared existing `fix/release-gate-stale-railway-api-token` branch; it is historical and not a validated fix for the current CI token.
- No existing CHAT 11 branch found before this checkpoint; other CHAT 01/02/04/05/06 work is independent and untouched.

## Item 101: evidence

1. [Main release gate run 41257568138](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41257568138) at the above SHA concluded `failure`; job `Syntax, tests and dependency audit` (job ID `124703885113`) failed at **Verify existing production secrets without changing them**.
2. The job log at 2026-11-01 00:42:15 UTC reports `Error: Not Authorized` from `scripts/railway-ensure-production-secrets.mjs:37`, called by `variables()` at line 44, initial read at line 80. This is a Railway GraphQL authorization denial, not proof of absent or weak SESSION_SECRET values.
3. [`.github/workflows/release-gate.yml`](https://github.com/GrafTrahula666/pivnik-bonus-app/blob/main/.github/workflows/release-gate.yml) passes `secrets.RAILWAY_API_TOKEN` to `node scripts/railway-ensure-production-secrets.mjs --check` on a `main` push (lines 117–128).
4. [The check script](https://github.com/GrafTrahula666/pivnik-bonus-app/blob/main/scripts/railway-ensure-production-secrets.mjs) sends `Authorization: Bearer` to `https://backboard.railway.com/graphql/v2` and queries `variables(projectId,environmentId,serviceId,unrendered:false)`. The `--check` branch does not call `variableCollectionUpsert`.
5. Railway connected-account read-only inventory can see the matching production project, environment and both Telegram/VK services; both latest corresponding deployments have status `SUCCESS` at 2026-11-01 00:37:40 UTC. This confirms the resources exist; it does **not** validate the separate GitHub Actions token.
6. The officially documented API distinguishes account/workspace Bearer tokens and environment-scoped project tokens using `Project-Access-Token`: https://docs.railway.com/integrations/api . A wrong token type, revoked token, wrong workspace or insufficient scope are plausible; the exact cause **cannot be proven** without a controlled, secret-safe token validation by an authorized operator.
7. The old [`ops/RAILWAY-ACCESS.md`](https://github.com/GrafTrahula666/pivnik-bonus-app/blob/main/ops/RAILWAY-ACCESS.md) says a token created with "No workspace" yields no project access; the current official Railway documentation describes "No workspace" as a broad account token. Do not treat that old runbook wording as reliable token-selection guidance. This documentation discrepancy is recorded here, not changed as a side task.

## Item 101 state and safe next action

**Diagnosis: bounded and evidence-backed. Exact token-level root cause: BLOCKED on authorized operator verification.** Priority: P1 release reliability (GitHub release gate on main fails); no confirmed outage of the running Telegram/VK services.

For item 102, **do not** make the gate optional, add `continue-on-error`, grant permission from code, copy tokens into PR/logs, or retry the whole `main` release workflow without reviewing its later deploy step.

Suggested operator-controlled sequence (requires separate authorization):
1. Confirm the GitHub Actions repository secret `RAILWAY_API_TOKEN` is a current account/workspace API token and is intended for the actual production project; verify token type/scope in Railway's protected settings without sharing its value.
2. If invalid or incorrectly scoped, generate the least-privileged suitable account/workspace token and update the existing GitHub Actions repository secret using secure platform controls only; no token in chat, source, artifact or logs.
3. Run a **read-only** API diagnostic / `Pivnik Railway operator` discovery workflow, check IDs and that the production variable-read authorization is valid without printing values; then review release/deploy gates separately. Beware: a new push to `main` triggers a downstream deployment after the check passes.

## Tests / limitations / continuation

- Current GitHub run: failed in Railway authorization step, not a green release gate. Existing earlier CI steps ran; their result is evidence of that specific historic run only.
- Local `git status`, `materialize ×2`, `node --test`, `npm run check`, Business Vitest, audit, native PostgreSQL, browser E2E: **not run in CHAT 11**. This session used GitHub and Railway read-only connectors, not a local checkout or private credentials.
- No production configuration/variables or source runtime files changed. No real-cash/bonus tests performed.
- Hourly CHAT 11 automation creation was **rejected** because the user's plan already has 5 active scheduled tasks. Existing CHAT 01–05 automations were preserved; do not disable or overwrite them.
- Next CHAT 11 iteration must recheck fresh main, PRs/CI and this checkpoint. Stay on **101** until its exact token auth cause is safely validated, or record operator-dependent BLOCKED and coordinate item 102 with CHAT 01. Do not begin 103 while 101/102 unresolved.

## 2026-11-01 continuation: token-scope probe (same item 101)

- Revalidated `origin/main`: `c92ed7cd65f1a96d94363c2b7e212424ab078a73`; PR #335 remains **Draft**, independent from other chats.
- Reviewed the current [Railway Public API documentation](https://docs.railway.com/integrations/api): account/workspace tokens use `Authorization: Bearer`; environment-scoped project tokens use `Project-Access-Token`; GraphQL authorization failures may appear in the HTTP 200 `errors` array as `Not Authorized`.
- Added explicit manual-only `scripts/railway-ci-access-diagnostic.mjs --check`. It does only **read queries**, no mutations or deployment. It checks access to both configured Telegram and VK service variables but never prints their values. On a Bearer denial, it probes only `projectToken { projectId environmentId }` with the alternate token header, then returns safe classifications (`project_token_wrong_header`, `project_token_wrong_scope`, `bearer_access_unresolved`, `transport_unavailable`, or `variable_read_authorized`), without printing token, GraphQL response, project IDs or secret values.
- Added `test/railway-ci-access-diagnostic.test.js` with eight fixture tests for both services, alternate token header, cross-environment scope, token denials, HTTP errors, throttling, missing token and second-service failure.
- **Locally performed:** targeted `node --test test/railway-ci-access-diagnostic.test.js` using an isolated copy of the two new files and a placeholder `railway-production-config.mjs`: **8/8 passed**; `node --check` of the new script passed. This verifies the diagnostic logic but is **not** the full repository regression. No local checkout of the GitHub repository was available, and local git/network access was blocked. The actual repository CI run must be checked independently.
- Source commits on this Draft branch: diagnostic script `d50e34e7ddd35ef7be8e33f98b129dc2b28fad3d`, tests `b71b38d1b6b20bc8b8e4d8aeddfdbba9f064cf24`. No edits to existing release-gate workflow, deployment scripts, runtime, database, tokens or production. The manual diagnostic was **not** run against GitHub Actions secrets: token-level root cause stays BLOCKED on authorized execution.
- Safe follow-up: once a protected execution context is authorized, run the diagnostic with the existing CI secret injected by the platform, review only its controlled status output, then decide separately whether token replacement/scope correction is warranted. Do not add it to an untrusted PR workflow, echo a secret, or weaken the release gate.
