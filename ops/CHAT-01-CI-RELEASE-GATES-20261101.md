# SPACEVERSE / CHAT 01 — task 08: evidence-backed CI and release checklist

**Snapshot:** 2026-11-01 UTC. **Repo:** GrafTrahula666/pivnik-bonus-app. **Pinned current main:** c92ed7cd65f1a96d94363c2b7e212424ab078a73. **Mode:** documentation-only, isolated Draft PR, no merge or deployment.

Previous: [CHAT01-07 checkpoint standard, Draft #351](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/351); [CHAT01-06 serial integration runbook, Draft #350](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/350). **Next numbered task:** CHAT01-09 (independent PR compatibility and actual integration sequence); do NOT prematurely merge, deploy or start task 10.

This report distinguishes:
- **CONFIGURED:** a command or safety check actually exists in current main workflow/source.
- **REQUIRED BY GITHUB:** a check is named in the active ruleset; actual per-branch applicability still requires confirmation.
- **ACTUALLY PASSED/FAILED:** evidence from a particular GitHub run and exact SHA.
- **CONDITIONAL / MANUAL / PATH-FILTERED:** configured, but not guaranteed to run on every PR/main push.
- **MISSING / NOT VERIFIED:** proposed necessary gate without proof that it is currently enforced.
- **PRODUCTION:** must be checked by per-service deployed SHA and authorized business scenarios; neither PR CI nor a success deployment record proves live user E2E.

## 1. Main CI: actual observed gate, step-level evidence

At pinned main SHA, [Pivnik release gate #41257568138](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41257568138), job **Syntax, tests and dependency audit** (job 124703885113), **FAILED**.

| Check on pinned main CI | GitHub step result | Source |
| --- | --- | --- |
| Exact root/Admin dependency installation | SUCCESS | release-gate.yml, steps 4–5 |
| Runtime retirement audit, canonical | SUCCESS | step 6 |
| VK startup parity | SUCCESS | step 7 |
| Materialize, marker, second materialize + idempotent diff | SUCCESS | steps 8–10 |
| Runtime retirement audit, materialized, evidence artifact | SUCCESS | steps 11–12 |
| Root JavaScript syntax check / backup script bash syntax | SUCCESS | steps 13–14 |
| Root tests (\`npm test\` = \`node --test\` in root package.json) | SUCCESS | step 15 |
| Admin tests (\`npm test --prefix admin-platform\` = Vitest) | SUCCESS | step 16 |
| Admin dependency audit, high+ | SUCCESS | step 17 |
| Production root dependencies audit (\`--omit=dev --audit-level=high\`) | SUCCESS | step 18 |
| npm pack dry run | SUCCESS | step 19 |
| **Read-only check of existing Railway production secrets** | **FAILURE** | step 20, \`scripts/railway-ensure-production-secrets.mjs --check\`; job log shows **Error: Not Authorized** from GraphQL |
| Main-only exact-SHA Telegram/VK deployment & subsequent production probes | **SKIPPED** | steps 23–26, dependent on passing previous step |
| Legacy DB unify / Anna special-case migration | SKIPPED | steps 21–22; conditional actions, not part of routine main rollout |

**Interpretation:** Every success above is scoped to this exact CI attempt. No claim is made that all tests remain green on future heads. A FAILED read-only API authorization check **does not prove any production secret is missing**, nor does it authorize deleting that check. CHAT11 [Draft #335](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/335) owns the protected diagnostic flow; exact-head CI and controlled operator authorization remain separate requirements.

[VK native hosting main parity #41257568169](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41257568169) is **SUCCESS** on the same SHA, including the browser/static bundle checks. This cannot override the failed root main release gate.

### CRITICAL independent Railway status

GitHub's [combined legacy commit status](https://github.com/GrafTrahula666/pivnik-bonus-app/commit/c92ed7cd65f1a96d94363c2b7e212424ab078a73) reports **success** for three Railway service contexts. This is a different status source from the GitHub Actions job which failed. Never treat combined Railway green contexts as proof that required GitHub Actions or main-only production checks passed.

The inspected production Railway services (all \`source.repo=GrafTrahula666/pivnik-bonus-app\`, \`source.branch=main\`) each have \`source.checkSuites=false\`. Thus **Railway auto-deployment is not held by GitHub checks** on the observed source config. This is a potential operational race, even for documentation merges. Changes to deploy gating/source settings require separate owner approval and a safe migration/rollback plan; none are made here.

## 2. Configured workflow coverage vs required evidence

| Gate | Configured where | Scope of enforcement actually confirmed | Remaining gap / owner |
| --- | --- | --- | --- |
| **G00** main branch review + required status | Active repository ruleset **PIVNIK — Main Protection.** id 25152486 | Declares **1 approving review**, dismiss stale reviews, and required context **Syntax, tests and dependency audit**. No code-owner requirement. | **Per-branch ruleset applicability not independently proven**: returned \`conditions.ref_name.include=[]\`. Do not claim all branches are protected. CHAT01/operator must verify actual main enforcement before merge. |
| **G01** materialization two passes + byte/source diff | \`.github/workflows/release-gate.yml\` | Runs on all PRs and pushes to main; recorded SUCCESS at pinned main run | Must re-run on **exact integration head**, after any rebase/PR merge; one \`apply-*.mjs\` retirement at a time, with explicit before/after file hash comparison |
| **G02** runtime-retirement and VK startup parity | release-gate.yml | Canonical and materialized retirement audit + VK startup parity are configured; SUCCESS in pinned main run | Patch-chain-specific full byte comparison/audit: per-retirement task, not blanket permission to retire scripts |
| **G03** root JS syntax, Node tests | release-gate.yml; root \`npm run check\`, \`npm test\` | Configured + SUCCESS at pinned main | Missing specific **two-server auth/staff/leaderboard HTTP parity matrix as a universally enforced distinct gate**. CHAT02/affected route owner must test both implementations when changed |
| **G04** Admin Vitest / npm dependency audits | release-gate.yml | Admin Vitest + high severity Admin audit + root production high audit configured and SUCCESS | **Not full root \`npm audit\`** (including dev dependencies); root \`npm run check\` is JS syntax, not Admin TypeScript/build. Before merge, separately record \`npm audit\` result and appropriate Admin typecheck/build/lint as required by task |
| **G05** Admin browser/Desktop/Mobile | \`business-cash-browser.yml\` | PR **path-filter** \`admin-platform/**\`, \`pos/**\`, workflow file; executes Playwright cash browser plus onboarding E2E and optional CRM pagination config | **Not a universally required check** for every PR. Explicit browser/mobile tests of affected task and full tenant/RBAC denial are not established by this workflow alone. CHAT04/CHAT08/CHAT01 own coverage review |
| **G06** Admin native DB integration | \`spaceverse-crm-native-postgres.yml\`, \`beer-inventory-postgres.yml\`, \`evotor-market-native-postgres.yml\`, \`evotor-owner-nonce-postgres.yml\` | They use **disposable PostgreSQL**, typically **pull_request paths** and/or **manual workflow_dispatch**, not proven to run for every main commit | No generic proof of live tenant/customer isolation or signed provider owner/license. CHAT02/03/04/05/10 own domain negative tests; before merge require targeted run on exact head |
| **G07** fiscal/bridge native tests | \`evotor-integration.yml\`, \`evotor-bridge-apk.yml\` | PR path-/named-branch-specific or workflow_dispatch. Includes PostgreSQL concurrency and Java/Android build checks, unsigned artifacts | A generated unsigned APK **is not an installable approved release**. Root kiosk signing continuity is independent: installed cert SHA-256, compatible key + 2–3 secured backups NOT verified. CHAT06 + kiosk owner |
| **G08** VK bundle+runtime recovery tests | \`vk-native-hosting-main-parity.yml\` | Push main + PR path-filter. Separate workflow success at pinned SHA, includes browser smoke/recovery/static bundle check | **Not live authenticated Telegram+VK E2E**, no evidence every customer/venue path is covered. CHAT01/operator |
| **G09** production secret read access | release-gate.yml step 20 | **Main push only**, plus exceptional named audit branch; PRs generally skip it. **FAILED** at pinned main | **P1 release blocker**. CHAT11 diagnostic #335, authorized operator must restore read-only access without echoing secrets or disabling required gate. PR green cannot prove this check |
| **G10** exact-SHA production deploy and gateway release probes | release-gate.yml steps 23–26; \`scripts/railway-deploy-and-verify-production.mjs\` | **Main-only and after G09**; deploy script explicitly handles **Telegram and VK**, not Admin. SKIPPED in pinned GitHub run | Railway independently auto-deployed guest services despite skipped Actions steps. Must reconcile **per-service SHA**, readiness and CI. CHAT01 release operator |
| **G11** separate Admin deployment verification | Railway \`admin-pilot\` Dockerfile/service \`/api/admin/health\` | Admin service independently watches source files, may SKIP unrelated commits, Dockerfile runs its own typecheck/lint/test/security/build when built | No proven **single main-push required CI gate** that checks Admin deployed exact intended SHA + authenticated tenant E2E. CHAT01 + Admin owner; require per-release evidence |
| **G12** production readiness on demand | \`production-readiness.yml\` | Trigger **workflow_dispatch** only, calls \`probe-current-production.mjs\` and \`verify-unified-production.mjs\` | NOT an automatically required main/PR check. Distinguish legacy unified-verification from current separate-account checks. Operator must inspect exact relevant script semantics before invocation |
| **G13** external SaaS provisioning/license/legal | Source-level drafts and Evotor runbook | Provider OAuth/store owner proof, signed license and legal commercial agreement are **not established by green root CI** | **P0 commercial NO-GO** until real signed provider identity/ownership, independent tenant RBAC, license entitlement and legal gate are verified; CHAT03/04/05/07/12 |
| **G14** release lock + rollback proof | [CHAT01-06 Draft #350](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/350) and root ops backup/restore scripts | **Documented only**, no global exclusive merge mutex confirmed, no executed backup/restore test in CHAT01 | A GitHub action concurrency group is **per github.ref**, NOT an across-all-agents merge/deploy lock. Operator must establish and record an exclusive release window. No automated production DB restore; \`ops/restore-postgres.sh\` uses destructive \`pg_restore --clean\`. |
| **G15** live authorized end-to-end | No universal always-required workflow established | **NOT_RUN in this coordinator task** | After explicitly permitted release, real Telegram/VK login, QR, reward, staff, POS, Admin tenant isolation/mobile and Evotor read-only scenarios with timestamps and redacted proofs; never test destructive financial writes on live data as a shortcut |

**Do not apply a universal "green"** to path-filtered checks or workflows run on a different head. Confirm exact workflow name, trigger, commit SHA, job result and run URL.

## 3. Practical pass/fail checklist for an authorized *single* release

Use [CHAT01-07 standard, Draft #351](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/351) to record each checkbox's exact evidence. Default = **HOLD** when evidence is UNKNOWN.

### Preparation, before merge (CI does not imply production authority)

- [ ] Release owner explicitly approved the exact candidate + expected production effects and acquired a **real single-flight integration lock** (record who, UTC and scope).
- [ ] Refresh exact origin/main, PR head, PR diff, full changed-file list, origin alternative branches and competing agent/PR work; resolve conflicts at **path + API consumer** level, not by overwriting whole files.
- [ ] The current PR is no longer an unreviewed Draft. Check effective main branch protection, one required approval and exact-head \`Syntax, tests and dependency audit\` required status. Verify branch ruleset actually applies.
- [ ] Run \`npm run materialize\` **twice**, verify prepared files byte-for-byte/idempotent; \`node --test\`, \`npm run check\`, \`npm audit\`, \`npm audit --omit=dev --audit-level=high\`, \`npm run audit:runtime-retirement\` if scope requires. Save full exact-head results, not a historical test count.
- [ ] For Admin changes: \`npm run typecheck --prefix admin-platform\`, \`npm run lint --prefix admin-platform\`, \`npm run build --prefix admin-platform\`, Vitest, relevant scoped native PostgreSQL and Playwright desktop/mobile checks. Preserve unknown vs configured zero, access denial and failed/empty/loading states.
- [ ] For root auth/staff/admin/leaderboard/QR/profile changes, compare \`server.js\` and \`universal-server.js\`; add negative route parity tests to actual head. For money, retain canonical POS locks, refund/idempotency checks, no client-supplied authoritative amount.
- [ ] For Evotor integration and SaaS activation, verify server-only OAuth state, provider owner proof, canonical store binding, signed license and agreement prerequisites; migration read/write gates and independent-tenant authorization. A provider inbox callback is not activation.
- [ ] Before kiosk update: verify installed APK signing cert vs proposed artifact **read-only**, existing compatible signing key and 2–3 independently recoverable protected backups. Draft branch/device image never installed on live kiosk without separate explicit risk approval.
- [ ] Required GitHub gate and all relevant conditional workflows are **SUCCESS on exact reviewed head**; current main-specific read-only Railway check has separately confirmed access. Do not assume PR CI ran it.

### Release execution and independent Railway observation

- [ ] One authorized merge only; capture resulting **main merge SHA**, release lock and approval evidence. Stop other merges, releases and manual Railway operators until close.
- [ ] Observe GitHub **main push CI** in full, including Railway read check and late deploy/readiness/auth steps; independently monitor Railway services because \`checkSuites=false\` permits deployment despite CI failure.
- [ ] Record independent **pivnik-bonus-app**, **pivnik-vk-test**, **admin-pilot** environment, service ID, deployment ID, status, actual deployed **40-char SHA** and time. Admin \`SKIPPED\` is not a success deployment of the new SHA.
- [ ] Verify service readiness, platform/DB fingerprint separation, source currency/coverage and Admin API response contracts; do not infer effective feature enablement from environment variable *names*.
- [ ] Perform explicitly authorized live smoke and negative tenant tests on relevant scopes, guest platforms, cashier/receipt and kiosk **without exposing personal data or introducing synthetic production money records**; record UNKNOWN/NOT_RUN accurately.
- [ ] If any failure, cross-service SHA drift, wrong-tenant read, signing discrepancy or unverified financial path occurs: **HOLD**, freeze next merge, record incident and execute only separately approved, backward-compatible service rollback. **Never** automatically run \`pg_restore --clean\` or destructive down migration.
- [ ] Close release lock only after signed-off post-release evidence, zero unresolved high-risk conditions and a clearly recorded owner decision. **Commercial GO** additionally requires independent Evotor/provider/license/legal acceptance.

## 4. Current known release blockers, owners and suggested changes (NOT executed)

| Priority | Missing/broken evidence | Proposed isolated next work (separate authorization) |
| --- | --- | --- |
| **P0** | Production auto-deploy not explicitly gated by GitHub check suites; production can change while required main Actions has FAILED | CHAT01/DevOps + owner: design safe per-service release gating, migration-safe rollback; **do not** flip Railway settings in this task |
| **P0** | Kiosk installed signing identity and key backup continuity not independently verified | Kiosk owner: compare installed SHA-256 certificate, existing keystore, verify 2–3 protected backup/restore paths; **do not generate replacement key** |
| **P0 commercial** | Third-party OAuth owner proof, signed store entitlement, legal/publisher approvals, complete independent tenant E2E not evidenced as commercially live | CHAT02/03/04/05/07/12 + release owner: collect exact verified proof and gated disabled-to-ready transition |
| **P1** | Main release gate FAILED at Railway GraphQL \`Not Authorized\`; late main-only deploy/probes SKIPPED | CHAT11 [Draft #335](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/335) owns diagnosis; operator fixes authorized CI access without secrets leakage or weakened CI |
| **P1** | Admin exact-SHA deploy verification + authenticated tenant E2E not an always-required main gate | CHAT01 + Admin owner: prove current deployed SHA and add separate approved conditional/full release gate, protect safe deploy order |
| **P2** | Domain-specific PostgreSQL and browser workflows path-filtered/manual; no globally required mobile/route parity matrix | CHAT02/04/06/08/09: require task-specific targeted evidence; propose reviewable policy, **not** blanket new required checks without feasibility |
| **P2** | Root full \`npm audit\` and Admin build/lint/typecheck not explicitly in universal root release-gate job | CHAT11 + service owner: document how conditional workflow/Dockerfile verifies these and whether to add selective non-destructive required tests |
| **P2** | Main ruleset returned active review/check configuration, but condition \`ref_name.include=[]\`; exact main match not independently demonstrated | CHAT01/operator: verify actual GitHub branch protection and review restrictions from authoritative main-branch settings before relying on a merge block |

## 5. Evidence: live deployment state as inspected, NOT live scenario results

- **GitHub main**: \`c92ed7cd65f1a96d94363c2b7e212424ab078a73\`. [Root gate](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41257568138) FAILED; [VK parity](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41257568169) SUCCESS.
- **Railway Telegram production** (\`pivnik-bonus-app\`): SUCCESS, deployment \`19d17252-3c93-4e10-82d1-38126d08263a\`, SHA \`c92ed7cd65f1a96d94363c2b7e212424ab078a73\`.
- **Railway VK production** (\`pivnik-vk-test\`): SUCCESS, deployment \`d34c69f1-56d6-41e6-9955-eba8afab32c4\`, SHA \`c92ed7cd65f1a96d94363c2b7e212424ab078a73\`.
- **Railway SPACEVERSE Admin production** (\`admin-pilot\`): last successful deployment \`02b2d42e-1c48-4822-930d-158fb30ce510\` on \`febca6ae6ce7be85a53eaf0e4a38fe1f087385ff\`. Latest attempted main \`c92ed7cd\` deployment \`09b8219f-6e55-4406-8c64-71d499096956\` **SKIPPED**, not a deploy to latest main.
- **Production live signed E2E:** NOT_RUN by this task, no statement of login/transactions/tenant success. Railway \`canRollback=true\` on prior successful deployments is metadata, not a tested data rollback.
- **Recent parallel work:** CHAT01-07 [#351](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/351) is still Draft; CHAT11 [#335](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/335) is still Draft on a newer head; CHAT09 [#348](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/348), CHAT04 [#349](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/349), CHAT14 [#352](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/352) are separate Draft work. Do not consolidate silently.

## 6. Completion and next step

- **CHAT01-08: DONE as documented audit and release checklist**, **NOT** code/test fixes, approved merge, enabled gate or commercial release.
- **Personally verified in this task:** exact GitHub main, MODULE-MAP's Do-not-break (old historical 433 count remains only on main pending [CHAT01-04 #346](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/346)), last CHAT01-07 checkpoint, workflow files/trigger syntax, main workflow job steps + filtered log error, current root/Admin package scripts, Dockerfile, repository ruleset, Railway service source config and per-service latest deployments.
- **Tests not executed here:** root materialize twice, \`node --test\`, \`npm run check\`, full \`npm audit\`, Admin build/typecheck/lint, disposable PostgreSQL, Playwright, live tenant/POS/auth E2E, kiosk certificate. Successful GitHub job steps above were **observed**, not rerun in this environment.
- **No changes made:** main, JavaScript/TypeScript, GitHub workflow, branch protection, Railway, environment variables, secrets, PostgreSQL, production services, kiosk, APK.
- **Next ONLY:** **CHAT01-09**: review independent PR heads and compare exact compatibility after refreshing main, propose a concrete staged integration sequence for review; no automatic merge/deploy.