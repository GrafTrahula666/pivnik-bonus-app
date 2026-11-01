# SPACEVERSE / CHAT 01 / task 09: PR compatibility and integration sequence

**Snapshot 2026-11-01 UTC.** Verified origin/main: **c92ed7cd65f1a96d94363c2b7e212424ab078a73**, 87 open PRs at observation. Mode: isolated documentation-only Draft. No merge, production deploy, CI settings change, data/secret access or kiosk action.

Previous checkpoints: [task 08 #353](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/353), [task 07 #351](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/351), [task 06 #350](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/350), [task 05 #347](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/347). **Next only CHAT01 task 10: commercial evidence-based GO/NO-GO.**

## 1. Global HOLD before any merge

- [Main release-gate run 41257568138](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41257568138) FAILED at main-only Railway read-only secret-check, GraphQL Not Authorized. Main Actions deploy/probes were SKIPPED. This does NOT establish that a token is absent. CHAT11 [Draft #335](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/335) implements a protected diagnostic and its [PR release-gate 41268695031](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41268695031) succeeded; an ordinary PR does **not** run the main-only authorization check. Blocker remains.
- Telegram, VK and Admin Railway services track main, with source.checkSuites=false at the inspected configuration. **A main merge, even docs-only, can auto-deploy despite a failed GitHub Action.** No released/approved single-flight lock is enforced automatically by the CHAT01 docs.
- Railway snapshot: Telegram pivnik-bonus-app SUCCESS c92ed7cd (deployment 19d17252-3c93-4e10-82d1-38126d08263a); VK pivnik-vk-test SUCCESS c92ed7cd (d34c69f1-56d6-41e6-9955-eba8afab32c4); Admin admin-pilot last successful febca6ae (02b2d42e-1c48-4822-930d-158fb30ce510), latest c92ed7cd attempt SKIPPED. These are provider deployment statuses, NOT authorized live E2E results.
- Main MODULE-MAP Do-not-break requires: double materialize idempotence, migration 007 immutable, QR revoked/merged aliases preserved, Telegram/VK account isolation, profile escaping, Telegram timeout, broadcast deduplication, server-side wheel odds, staff bonus thresholds, and VK bundle parity. Historical 433 test count on main is not an updated baseline; #346 contains a Draft correction.
- **Never merge a still-Draft, unreviewed or unchecked PR on the assumption that GitHub says mergeable.** First verify effective main ruleset, approval, exact-head tests, safe rollback and explicit merge/deploy authorization. No review or approval was supplied by this checkpoint.

## 2. Current PR heads and independent CI evidence

All compared candidates below are ahead of main with behind=0 in GitHub compare_commits. They were independently based on main, **not** on each other.

| PR | Inspected full HEAD SHA | Compare main to HEAD | Exact-head GitHub CI |
| --- | --- | --- | --- |
| [#335 CHAT11](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/335) | 8fd402bd47b5fc86ffb4128ebc97de6ad4ec2bc7 | +9 commits, 4 files | [release gate success](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41268695031); main-only token gate not exercised |
| [#333 CHAT10](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/333) | c2361e7ac7af4be8667d18e00c58deb909d38ca8 | +11, 7 files | [release success](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41268978528), [native loyalty PG success](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41268978526) |
| [#344 CHAT09](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/344) | a24b37925a8190448f77c3029c03340769d6ba61 | +1, 7 files | [release](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41267272724), [PG](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41267272732), [browser](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41267272718): SUCCESS |
| [#348 CHAT09](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/348) | d43a0e380da1bed6501e608033a630bc64f01fe6 | +2, 8 files | [release](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41268295975), [Evotor](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41268295953), [PG](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41268295961), [browser](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41268296029): SUCCESS |
| [#354 CHAT09](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/354) | 27c4fc24505e42dad98c2b42d0fab4a8d37315e9 | +2, 6 files | [release](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41268998234), [PG](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41268998273), [browser](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41268998216): SUCCESS |
| [#343 CHAT08](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/343) | 50c8cc3de07147c38f3e0eb1de7bda793942e949 | +18, 13 files | [release](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41269203480), [browser](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41269203423), [PG](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41269203406): IN_PROGRESS at check |
| [#349 CHAT04](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/349) | a038fb596761bcb8400776a0e5098e7bd48e068b | +8, 5 files | [release](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41268353615), [PG](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41268353592), [browser](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41268353545): SUCCESS |
| [#355 CHAT04](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/355) | d30713db8625a8c26f3340874ce4aaa7f5321aa9 | +2, 2 files | [PG](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41269029432), [browser](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41269029446) SUCCESS; [release](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41269029435) IN_PROGRESS at check |

Also inspected:
- [#339 CHAT02](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/339): a907f8c2ec08fb257d380fb4201ff15ff0d52aed, narrow **unmounted** authorization helpers; this alone does not prove route RBAC.
- [#340 CHAT04](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/340): ed4cf37397556f1f8f65934cda70cc4a26f110db, wizard navigation.
- [#345 CHAT04](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/345): 48c9602b9c29b33d28e8673280eafc630526d409, company ownership tests.
- [#336 CHAT13](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/336): 7f15e5f2a9488c630e46b68ff438387e3b40611c, marketing consent policy/reader/writer and manual SQL, not proven live.
- [#346 CHAT01](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/346): a674d15e44086398cb2cb1255ef1967c54aba1a5, MODULE-MAP and gateway inventory corrections.
- [#96 legacy](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/96): febefa93f6a53c3b47db3a1fe2ec3ed727baaac8, 141 files, Draft, mergeable=false.
- [#165 kiosk](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/165): d982913eaa5703a00ac388a739d23bcaa5af49ab, 62 files, Draft, mergeable=false.

**CI results above belong ONLY to the exact independent PR heads, not to the hypothetical combined tree.** A subsequent push invalidates them for a later head.

## 3. Exact source-level conflicts and required compatibility tests

### C1 — THREE separate changes to one Evotor read contract

PRs #344, #348 and #354 change the SAME three files:
- admin-platform/server/evotor-read.ts
- admin-platform/server/tests/evotor-read.spec.ts
- ops/MODULE-MAP.md

At the exact branch-head source, each separately changes the same API result:
- #344 adds **timeSeries** with null for missing/unready POS, and server-side scoped hourly/daily net cash time-series when connected.
- #348 adds **receiptRanking** with null when unavailable, ranking only verified source receipts.
- #354 adds **verifiedCustomerCohorts** with null when unconnected; verified links exclude split/unverified/merged/foreign-store records. This branch explicitly refuses to invent first-ever customer counts.

Each of those branches was based directly on main and **does not include** the other branches' field. If an integrator replaces the entire file using one branch version, the other two features disappear. GitHub reports these PRs as mergeable individually; that is **not** a proof of three-way semantic compatibility.

**Required integrated output:** preserve base fields period, connection, all, app, unlinked, linkedRevenueSharePercent, plus **all three optional extensions**. A missing/unready source returns the correct null/unknown states. Preserve scoped store/company/venue, fiscal SELL/PAYBACK integrity, verified receipt ranking, single-store customer links, Moscow days/hours, signed integer precision and existing consumer validator behavior.

**Combined tests before each merge:** missing schema/store; store disabled; known connected receipts; nonmatching tenant/store; refunds/split/merged identity; unknown category; exact time bounds; null vs [] vs zero; no names/phones/time-based identity guess; existing API clients and browser rendering. Run both unit adapter and native DB/Playwright on a fresh integration candidate.

### C2 — MODULE-MAP overlaps across teams

The following concurrent PRs all modify the exact path ops/MODULE-MAP.md: **#343, #344, #348, #349, #354 and #346**. Line-level Git hunk conflicts were **NOT computed**; same-file intersection alone is not proof of a merge conflict. Integrator must carry forward distinct current source facts (including 10 gateway/Express user-action overlaps from #346) rather than choosing one old whole-file version. Refresh the official Do-not-break section.

### C3 — Other relationships

| Candidates | Dependency / exact-file collision | Acceptance |
| --- | --- | --- |
| #343 UI versus #344/#348/#354 server | No exact shared runtime file besides MODULE-MAP. #343 modifies CashDashboard, ProductionDashboard, SalesDashboard, CashComparison, cash-format and tests; UI consumes existing Admin POS/operations APIs. | Check old/new payloads, dates/hours, source labels, unknown vs zero, desktop/mobile touch/keyboard and error/loading states. The new fields are **not automatically displayed** by #343. |
| #345 ownership tests, #349 venue lifecycle, #355 invite-chain tests, #340 wizard UI | Different runtime files (no confirmed shared code paths), but one onboarding authorization/provisioning story. | Server first: inactive company/venue, foreign tenant denied, no false active, revocation cascade/TTL; UI last and browser/mobile proof. |
| #339 versus historic #96 | Exact overlapping authorization membership/middleware + tests. #339 helper not proven mounted. | Do not import #96 wholesale. Test actual guest and Admin route/SQL scope, role and revoked grants; duplicate root server.js/universal-server.js parity separately. |
| #333 loyalty versus independent venues | No exact runtime-file intersection with #349, but shared tenant semantics. | Explicit configured 0 stays 0, missing settings become not-configured/null, no PIVNIK fallback to another tenant, privileged writes only. |
| #336 marketing versus #348 and #96/#165 | Same root package.json path; consent helper/writer not proven connected to live broadcast endpoints. | Review root package script/lockfile changes separately; no manual production SQL or messaging activation without owner/legal proof. |
| #335 diagnostic versus main release gate | Modifies operator workflow, not root release-gate.yml; root main Railway authorization remains unresolved. | Verify read-only main API authorization with protected operator workflow after approval; do not disable checks. |

Other 87 open PRs were **not exhaustively audited**. Each integration must refresh exact heads and include additional changed PRs before approval.

## 4. Conditional serial integration sequence, after GLOBAL HOLD lifted

This is a dependency plan, **not a merge schedule or authorization**. All listed PRs are currently Draft. One reviewed PR at a time; after every merge verify GitHub main CI plus independent Railway deployment and guest/Admin live behavior; only then proceed.

| Slot | Candidate | Prerequisite and stop condition |
| --- | --- | --- |
| **STOP 0** | Restore authorized GitHub Railway access, verify main release gate and independently controlled Railway auto-deploy, designate one release owner/lock | Do not merge even docs-only while this is unknown. Prior #335 PR success does not resolve main authorization. |
| **R1** | CHAT02 #339 narrow RBAC helper | Confirm real guest/Admin route consumers + foreign tenant/role tests; no #96 wholesale merge. This is foundation, not full mounted RBAC completion. |
| **R2** | CHAT04 #345 company ownership tests | Signed HTTP/disposable DB negative tenant checks, idempotent inactive scope. |
| **R3** | CHAT04 #349 venue lifecycle | Preserve no-false-active binding, server statuses and ownership; merge revised MODULE-MAP. |
| **R4** | CHAT04 #355 invite TTL/revocation tests | Re-run exact-head tests after R3 integration; do not claim passing while release CI is running. |
| **R5** | CHAT04 #340 wizard navigation | Server proof first; desktop/mobile UI, disabled actions, no automatic activation. |
| **R6** | CHAT09 #344 timeSeries | Preserve baseline POS report and period/tenant/financial scope. |
| **R7** | CHAT09 #348 receiptRanking | Rebase/port on R6; preserve timeSeries and package manifest. Combined API and DB tests. |
| **R8** | CHAT09 #354 verifiedCustomerCohorts | Rebase/port on R7; preserve BOTH previous extensions. Test null, foreign store, unverified links, split/return, no invented first-ever buyers. |
| **R9** | CHAT08 #343 Dashboard consumer | Require latest-head all-green CI and combined POS/API/date/browser/mobile verification. |
| **R10** | CHAT10 #333 tenant loyalty | Can move earlier with a separate authorized window; test no sibling-tenant default bleed and explicit real zero. |
| **R11** | CHAT01 docs #325/#337/#342/#346/#347/#350/#351/#353 (and this checkpoint) | Docs are not required to land first. For #346 preserve merged MODULE-MAP content. No mass merge of historical checkpoints. |

**Explicit deferrals:** CHAT05/06/07/12 legal, Evotor owner OAuth/license/store proof and production cash authorization require separate commercial/legal gates; CHAT13 #336 marketing consent is unmounted and cannot grant permission for production sends. CHAT14 AI docs are not a running AI service. Legacy #96 and kiosk #165 are broad old incompatible Drafts; do not merge wholesale. Real kiosk must retain its current compatible release signing key with 2–3 independently verified backups; never install a Draft APK. Do not bundle unrelated patch-chain retirements or server route splitting.

## 5. Mandatory checklist for each authorized integration, once unlocked

1. Refresh main full SHA, PR head and updated file list, all relevant origin branches, ruleset and any live concurrent release. Select one responsible integrator and a real single-flight lock.
2. On a fresh main candidate, reconcile precise files and API consumers, not whole-file overwrites; use exact combined payload tests for three Evotor extensions. Confirm tenant boundaries and financial source.
3. Execute and record root materialize twice/idempotence, node --test, npm run check, full npm audit and production-high audit; Admin build/typecheck/lint/Vitest, native PostgreSQL and browser/mobile tests for the changed domain; legacy root duplicated routes parity and VK bundle where relevant. A previous PR CI success does not substitute for combined-head tests.
4. Obtain explicit release/merge authorization, GitHub required review and exact-head status, and rollback feasibility. **One merge**, record resulting merged main SHA, then wait for GitHub main gate AND independent Railway Telegram/VK/Admin deployment status/SHA. Admin SKIPPED remains SKIPPED.
5. Perform only authorized non-destructive live smoke: TG/VK login and identity separation, QR/bonus/staff, fiscal read model, independent tenant Admin denial, mobile, health and API source coverage. Never insert synthetic financial data in live production.
6. If any safety gate fails, freeze other merges, record incident and cross-service SHA drift; any Railway rollback requires separate authorization and backward-compatible schema. Never automatically run destructive pg_restore --clean or change kiosk signing identity.
7. Close release lock and approve the next PR **only after** actual evidence is recorded in [CHAT01 checkpoint #351](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/351).

## 6. Task status

**Task 09 completed as source/PR compatibility analysis and isolated Draft documentation ONLY.** Main c92ed7cd, 87 open PRs at observation. Verified: origin PR metadata/changed files, selected compare_commits (ahead / behind 0), exact-head CI runs, source evotor-read.ts in main/#344/#348/#354, onboarding lifecycle #349 and Dashboard #343, real Railway deployment metadata, MODULE-MAP Do-not-break and previous release-gate blocker.

**NOT DONE/NOT VERIFIED:** local git checkout, root/Admin tests run by this coordinator, combined branch tests, actual file-hunk merge, production authenticated customer/owner E2E, provider/contract/license proof, installed kiosk cert, backups, CI credential repair, merge, deploy, data modification or rollback. Green PR CI belongs to individual separate branches. No secrets accessed.

**Risk:** P0 direct production auto-deploy/tenant and kiosk continuity; P1 Railway authorization; P2 shared Evotor report/MODULE-MAP content and stale CI upon new push.

**Next only:** CHAT01-10 commercial launch GO/NO-GO assessment, without executing production actions.