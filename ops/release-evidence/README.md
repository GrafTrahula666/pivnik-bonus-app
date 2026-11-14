# CI-01 · PIVNIK release evidence (Draft, not release approval)

This directory holds the **offline evidence format** for a completed, explicitly approved PIVNIK release. The template is intentionally invalid until actual IDs, hashes, UTC timestamps, check URLs, smoke results and independent approval are substituted.

Run the validator only against a copied and completed manifest:

```sh
node scripts/validate-release-evidence.mjs /path/to/completed-release-manifest.json
node --test test/release-evidence.test.js
```

The validator fails closed when checks, artifacts, deployments or smoke results have a different SHA; when an optional skip lacks a reason; when the common **Pivnik release gate** is not a successful mandatory `workflow_dispatch` with `releaseConfirm=DEPLOY_PIVNIK_PRODUCTION`, a positive `runAttempt`, and all four mandatory production steps reported `success` (a green `CANCEL` dispatch must fail); when VK Hosting lacks successful VK parity; when any deployed target lacks passing post-deploy smoke; or when rollback lacks a separately identified known-good commit and evidence. It also checks that declared artifacts have SHA-256 hashes and approval/deployment/smoke timestamps are ordered. The independent approval record must explicitly declare `approval.sha` equal to `releaseSha`, the **final main merge commit SHA** returned by GitHub as `pull_request.merge_commit_sha`. The review itself binds to the reviewed PR head (`review.commit_id == pull_request.head.sha`), which normally differs from that merge SHA. An approval for another commit, a branch name, or an absent SHA is rejected. All URLs must be HTTPS. A manifest covers exactly its declared deployment targets; it is **not** a claim about undeclared systems.

## Critical trust boundary

**Passing this validator does NOT authorize a production release.** The default offline mode only checks self-reported JSON. With `PIVNIK_VERIFY_GITHUB=1` and an authorized `GITHUB_TOKEN` (including Actions artifact read access), the CLI additionally checks GitHub PR merge/review state, exact-SHA workflow runs/jobs and the run-scoped dispatch artifact's downloaded ZIP digest and exact JSON payload, but it still does not validate Railway/VK deployment records, installed commits, branch protection or a practiced rollback. These facts require **independent, trusted external verification** on the exact release SHA, including successful approved GitHub Actions run steps, deployment IDs, health and signed-session smoke and a practiced rollback. Do not wire this validator alone into a deploy-unlock condition.

The working Android kiosk, its signing key and APK are excluded from this UI/release track, as required by the master plan. Do not include secrets, client PII or token values in release manifests. Never manufacture evidence to make the sample pass.

## Dispatch confirmation attestation

The release workflow records the original `workflow_dispatch` inputs in `artifacts/release-dispatch/dispatch.json` and uploads that file with `actions/upload-artifact@v4`. The artifact name includes the workflow run ID, run attempt, `release_confirm` and `release_sha`, so the values are attached to the exact GitHub run rather than copied into a separate manifest.

`verifyGithubRuns()` does not rely on the workflow-run REST `inputs` property, which GitHub may omit. It queries `GET /actions/runs/{run_id}/artifacts?per_page=100` and requires exactly one non-expired artifact whose name matches `release-dispatch-<runId>-<runAttempt>-DEPLOY_PIVNIK_PRODUCTION-<releaseSha>`, whose workflow-run metadata matches this repository, `main` and the exact SHA, and whose creation time is inside the run's lifetime. A rerun cannot reuse a prior attempt because the attempt is part of the artifact name. Missing, paginated/incomplete, expired, empty or mismatched evidence fails closed.

The verifier checks authenticated GitHub artifact metadata, downloads the canonical ZIP URL, verifies the SHA-256 digest returned by GitHub, and parses exactly one bounded `dispatch.json` entry. It rejects multiple or unsafe entries, oversized/corrupt archives, digest mismatches, unexpected JSON keys, and any mismatch in repository/event/run/attempt/ref/workflow SHA/release SHA/confirmation. This is integrity and provenance checking over the artifact produced by the trusted workflow, not a GitHub cryptographic signature of the JSON contents. The token used for authenticated verification needs permission to read Actions artifacts (`actions:read`).

This binds the recorded dispatch values to the trusted workflow run, but it is **not independent human approval** and does not authorize a release. The separate approved-PR review, successful production steps, Railway/VK deployment readback, live smoke, known-good rollback and REL-01 protections remain mandatory. Do not wire this validator alone into a deploy-unlock condition.

## Operational dependency

As of November 9, 2026, production is blocked by [REL-01 / issue #483](https://github.com/GrafTrahula666/pivnik-bonus-app/issues/483): Railway app and VK Railway services still track `main` without a proven deploy gate, and the real common release gate has had production token-scope failures. The [VK guard Draft PR #482](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/482) has passed PR CI; it is not a substitute for Railway configuration or successful real release. Do not publish based on template validation.

The common gate's `productionSteps` must match the same GitHub Actions **run attempt** as `runId`. A `CANCEL` dispatch may make the workflow green by skipping all deployment/smoke work; it must never be represented as approved production evidence. The offline validator still cannot prove these reported step results without a separate trusted GitHub API read.

For each check, `evidenceUrl` must point to `https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/<runId>` with the exact matching numeric `runId`. This rejects accidentally copied or unrelated run links; it **does not** authenticate the run, its attempt, its status, or its actual SHA. Independently query GitHub for all of those before any release decision.
