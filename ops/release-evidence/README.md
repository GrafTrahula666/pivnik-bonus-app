# CI-01 · PIVNIK release evidence (Draft, not release approval)

This directory holds the **offline evidence format** for a completed, explicitly approved PIVNIK release. The template is intentionally invalid until actual IDs, hashes, UTC timestamps, check URLs, smoke results and independent approval are substituted.

Run the validator only against a copied and completed manifest:

```sh
node scripts/validate-release-evidence.mjs /path/to/completed-release-manifest.json
node --test test/release-evidence.test.js
```

The validator fails closed when checks, artifacts, deployments or smoke results have a different SHA; when an optional skip lacks a reason; when the common **Pivnik release gate** is not a successful mandatory `workflow_dispatch` with `releaseConfirm=DEPLOY_PIVNIK_PRODUCTION`, a positive `runAttempt`, and all four mandatory production steps reported `success` (a green `CANCEL` dispatch must fail); when VK Hosting lacks successful VK parity; when any deployed target lacks passing post-deploy smoke; or when rollback lacks a separately identified known-good commit and evidence. It also checks that declared artifacts have SHA-256 hashes and approval/deployment/smoke timestamps are ordered. The independent approval record must explicitly declare `approval.sha` equal to `releaseSha`, the **final main merge commit SHA** returned by GitHub as `pull_request.merge_commit_sha`. The authenticated approval also requires GitHub's reviewer `user.type` to be `User`: a bot approval, even from an account with repository write access, is not independent human release consent. The review itself binds to the reviewed PR head (`review.commit_id == pull_request.head.sha`), which normally differs from that merge SHA. An approval for another commit, a branch name, or an absent SHA is rejected. All URLs must be HTTPS. A manifest covers exactly its declared deployment targets; it is **not** a claim about undeclared systems.

## Critical trust boundary

**Passing this validator does NOT authorize a production release.** The default offline mode only checks self-reported JSON. With `PIVNIK_VERIFY_GITHUB=1` and an authorized `GITHUB_TOKEN` (including Actions artifact read access), the CLI additionally checks GitHub PR merge/review state, exact-SHA workflow runs/jobs and the run-scoped dispatch artifact's downloaded ZIP digest and exact JSON payload, but it still does not validate Railway/VK deployment records, installed commits, branch protection or a practiced rollback. These facts require **independent, trusted external verification** on the exact release SHA, including successful approved GitHub Actions run steps, deployment IDs, health and signed-session smoke and a practiced rollback. Do not wire this validator alone into a deploy-unlock condition.

### Optional Railway API attestation (read-only)

The existing `scripts/verify-railway-release-evidence.mjs` authenticated GraphQL lookup is now callable from the evidence CLI. With a **previously provisioned, appropriately scoped** `RAILWAY_TOKEN` in the execution environment, run:

```sh
PIVNIK_VERIFY_RAILWAY=1 node scripts/validate-release-evidence.mjs /path/to/completed-release-manifest.json
```

For both independent GitHub and Railway checks, additionally set `PIVNIK_VERIFY_GITHUB=1` with an authorized `GITHUB_TOKEN`. Do not paste tokens into arguments, manifest files or logs. `PIVNIK_VERIFY_RAILWAY=1` requires the token and fails closed on Railway HTTP/GraphQL errors, missing deployments, wrong environment/service/SHA, or invalid chronology. An explicitly set flag must be exactly `1`; even an empty string is rejected instead of silently skipping authenticated attestation. Without the flag, validation remains explicitly **offline**, not independently verified.

The live Railway GraphQL response is read as a bounded stream (128 KiB maximum per deployment); oversized responses fail closed rather than being parsed without a size limit.

This queries the two pinned production service IDs **without changing Railway**. In authenticated CLI mode, the verifier now independently queries Railway's **latest active successful deployment** for each pinned service using the documented `deployments(input: {projectId, environmentId, serviceId, status: {successfulOnly: true}}, first: 1)` GraphQL read. It rejects a historical `SUCCESS` if its deployment ID differs from the active ID; missing, malformed or ambiguous active responses also fail closed. It checks **both** PIVNIK and VK in **two consecutive sweeps**, rejecting a replacement observed during either readback. This is still an observation **at query time**, not an atomic two-service snapshot or a guarantee about routed live traffic; an update immediately after the final read can still occur. An operator-controlled deploy freeze and live smoke remain mandatory. Source: [Railway Public API deployment examples](https://docs.railway.com/integrations/api/manage-deployments).

For the manifest's **historical rollback deployment**, the read-only `verifyRailwayRollbackDeployment(manifest, { lookupDeployment, target })` authenticates one explicitly selected service/environment/deployment ID, status, previous SHA and chronology. It can also be requested through the existing CLI, **only when Railway authentication is enabled**, for exactly one named service:

```sh
PIVNIK_VERIFY_RAILWAY=1 PIVNIK_VERIFY_RAILWAY_ROLLBACK_TARGET=pivnik-bonus-app \
  node scripts/validate-release-evidence.mjs /path/to/completed-release-manifest.json
```

The rollback target must be `pivnik-bonus-app` or `vk-native-hosting`; unknown/blank values and a rollback flag without `PIVNIK_VERIFY_RAILWAY=1` fail closed. `RAILWAY_TOKEN` must already be present in the environment, not in the manifest or command line. With no rollback-target flag, the CLI **does not independently authenticate the rollback entry**. The single rollback ID in schema version 1 does not establish a known-good deploy for the other service. A successful historical provider lookup still does **not** prove artifact retention, image availability, reversible database changes, current running SHA or any actual rollback rehearsal. Never treat this as permission to deploy.\n\nSuccessful provider readback still does not prove that live traffic serves the commit, that auto-deploy is disabled, that approval is valid, or that rollback and smoke have been practiced. Do not use either check as a deploy unlock.

The working Android kiosk, its signing key and APK are excluded from this UI/release track, as required by the master plan. Do not include secrets, client PII or token values in release manifests. Never manufacture evidence to make the sample pass.

## Dispatch confirmation attestation

The release workflow records the original `workflow_dispatch` inputs in `artifacts/release-dispatch/dispatch.json` and uploads that file with `actions/upload-artifact@v4`. The artifact name includes the workflow run ID, run attempt, `release_confirm` and `release_sha`, so the values are attached to the exact GitHub run rather than copied into a separate manifest.

`verifyGithubRuns()` does not rely on the workflow-run REST `inputs` property, which GitHub may omit. It queries `GET /actions/runs/{run_id}/artifacts?per_page=100` and requires exactly one non-expired artifact whose name matches `release-dispatch-<runId>-<runAttempt>-DEPLOY_PIVNIK_PRODUCTION-<releaseSha>`, whose workflow-run metadata matches this repository, `main` and the exact SHA, and whose creation time is inside the run's lifetime. A rerun cannot reuse a prior attempt because the attempt is part of the artifact name. Missing, paginated/incomplete, expired, empty or mismatched evidence fails closed.

The verifier checks authenticated GitHub artifact metadata, requests the canonical ZIP endpoint with redirects disabled, and follows GitHub's `302` only to a validated HTTPS Azure Blob host **without forwarding the GitHub Bearer token**. Further redirects, non-HTTPS targets, embedded credentials and unrecognized hosts fail closed. It verifies the SHA-256 digest returned by GitHub and parses exactly one bounded `dispatch.json` entry. It rejects multiple or unsafe entries, oversized/corrupt archives, digest mismatches, unexpected JSON keys, and any mismatch in repository/event/run/attempt/ref/workflow SHA/release SHA/confirmation. This is integrity and provenance checking over the artifact produced by the trusted workflow, not a GitHub cryptographic signature of the JSON contents. The token used for authenticated verification needs permission to read Actions artifacts (`actions:read`).

This binds the recorded dispatch values to the trusted workflow run, but it is **not independent human approval** and does not authorize a release. The separate approved-PR review, successful production steps, Railway/VK deployment readback, live smoke, known-good rollback and REL-01 protections remain mandatory. Do not wire this validator alone into a deploy-unlock condition.


VK parity must also have finished **before the first production deployment**, not just succeeded eventually on the same SHA. Authenticated GitHub readback compares the parity run's UTC `updated_at` with the earliest declared production `deployedAt`. A late, missing, invalid or pre-start completion timestamp fails closed; `updated_at` is used conservatively because a later metadata update must never legitimize an earlier deploy retroactively. This is an additional chronology requirement, not independent permission to release.

## Operational dependency

As of November 9, 2026, production is blocked by [REL-01 / issue #483](https://github.com/GrafTrahula666/pivnik-bonus-app/issues/483): Railway app and VK Railway services still track `main` without a proven deploy gate, and the real common release gate has had production token-scope failures. The [VK guard Draft PR #482](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/482) has passed PR CI; it is not a substitute for Railway configuration or successful real release. Do not publish based on template validation.

The common gate's `productionSteps` must match the same GitHub Actions **run attempt** as `runId`. A `CANCEL` dispatch may make the workflow green by skipping all deployment/smoke work; it must never be represented as approved production evidence. The offline validator still cannot prove these reported step results without a separate trusted GitHub API read.

For each check, `evidenceUrl` must point to `https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/<runId>` with the exact matching numeric `runId`. This rejects accidentally copied or unrelated run links; it **does not** authenticate the run, its attempt, its status, or its actual SHA. Independently query GitHub for all of those before any release decision.

## Workflow and deploy-source matrix (source-checked 2026-11-23)

This is a trigger/evidence inventory, **not** proof that GitHub enforces required checks. Verify each row again on the exact candidate SHA. `main` presently reports `protected: false`, while applicability of ruleset 25152486 remains unproven. A missing job is never a successful job. Paths below refer to `.github/workflows/`.

| Workflow / independent source | Trigger / target SHA | Skip and evidence boundary |
| --- | --- | --- |
| [Pivnik release gate](../../.github/workflows/release-gate.yml) | PR; push to `main` / `audit/**`; explicit manual dispatch on `main` with `release_sha` and `DEPLOY_PIVNIK_PRODUCTION` | PR/push checks do **not** run production deploy/smoke. `CANCEL` can be green with skipped production steps. Main push attempts a production secret-read check, currently limited by Railway CI token scope. Capture exact SHA, run/attempt, canonical job, four production steps, dispatch artifact digest, double materialize, Node, Business, audits and pack. |
| [VK native hosting main parity](../../.github/workflows/vk-native-hosting-main-parity.yml) | Push to `main` (also legacy parity branch), no push path filter; PRs limited to named paths | An unrelated PR need not trigger parity. For production, require successful **main push** parity for the same SHA, completed before first deployment. Keep actual run ID and bundle evidence. |
| [VK native hosting PRODUCTION deploy](../../.github/workflows/vk-native-hosting-production.yml) | Completed successful `main` parity via `workflow_run`, or manual `workflow_dispatch` on `main` with `DEPLOY_VK_PRODUCTION` | A green parity can trigger publication despite red common gate. Exact-SHA common-release approval guard exists in **Draft PR #482** only and cannot be treated as live. Verify main SHA, bundle, HTTPS/API base, CORS, Hosting URL and smoke before publishing. |
| [Pivnik production readiness](../../.github/workflows/production-readiness.yml) | Manual dispatch only | Checks deployed public endpoints and unified production. Not automatically required, not a deploy and not proof of signed sessions. |
| [Pivnik Railway operator](../../.github/workflows/railway-operator.yml) | Manual dispatch, job restricted to `refs/heads/main` | `diagnose` and `discover` are token/resource diagnostics only. Successful lookup never authorizes deployment. |
| [Business cash browser check](../../.github/workflows/business-cash-browser.yml) | PR paths in `admin-platform/**`, `pos/**` or its workflow | Fixture-only Chromium/onboarding; not run on unrelated PRs. Separately require Business Vitest in the common gate. |
| [SPACEVERSE CRM native PostgreSQL](../../.github/workflows/spaceverse-crm-native-postgres.yml) / [loyalty native PostgreSQL](../../.github/workflows/spaceverse-loyalty-native-postgres.yml) | CRM: matching PR or manual dispatch; loyalty: matching PR only | Disposable PostgreSQL 16; path-filtered PR tests are not production DB smoke. CRM and RBAC acceptance remains with their separate agents. |
| [Evotor integration draft checks](../../.github/workflows/evotor-integration.yml) / [Evotor bridge APK](../../.github/workflows/evotor-bridge-apk.yml) | Evotor integration: matching PR or legacy branch; Bridge APK: manual or named feature branch | Separate POS/Bridge contour, not PIVNIK/VK release approval. Working Android kiosk, key and PR #165 are expressly excluded here. |
| Railway production services `pivnik-bonus-app` and `pivnik-vk-test` | Both live sources follow `main` with `source.checkSuites=false` as observed on 2026-11-23 | **REL-01 BLOCKED:** GitHub workflow success does not constrain Railway's own source-triggered deployment. No isolated nonproduction staging; do not perform negative gate tests in production. Existing [issue #483](https://github.com/GrafTrahula666/pivnik-bonus-app/issues/483) tracks required dashboard disable/readback and staging tests. |

### Minimum per-release evidence

1. Capture workflow **path, trigger/event, exact SHA, run ID, attempt, canonical job ID, observed conclusion and skip status**. A path-filtered job which never ran is `absent`, not `success`.
2. For explicit production dispatch, attest immutable dispatch artifact bytes/digest and successful mandatory steps through authenticated GitHub API. The self-written manifest is never approval.
3. Independently confirm the Railway production services/environment/deployment IDs and actual installed SHA, current running state, post-deploy endpoint/identity/session smoke, and practiced known-good rollback. GitHub tests do not prove Railway source protection or live traffic SHA.
4. Verify actual GitHub branch/ruleset applicability and Railway Source auto-deploy state before any production approval; changes to workflow triggers or `if`/path filters require separate review.
