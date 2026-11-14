# SPACEVERSE / CHAT 01 — origin branches, PR dependencies and conflict gate (task 03)

**Snapshot:** 2026-11-01 UTC. **Mode:** release-coordinator, read-only GitHub investigation; this file is the only change in the coordinator's isolated branch. No code, migrations, secrets, CI, Railway or kiosk were changed. No merge/deploy is authorized.

**Main SHA:** [`c92ed7cd65f1a96d94363c2b7e212424ab078a73`](https://github.com/GrafTrahula666/pivnik-bonus-app/commit/c92ed7cd65f1a96d94363c2b7e212424ab078a73).
**Previous tasks:** [CHAT01-01 Draft #325](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/325), [CHAT01-02 Draft #337](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/337), both still open at this snapshot. This document is task **03/10**. **Next:** task 04/10, inspect shared-file/API contract boundaries against recent workstreams.

## Verified remote ancestry / branch state

Data retrieved through GitHub PR metadata, current branch listings and REST compare `main...head`. Counts can change when a branch is updated. **Ahead/behind numbers count commits, not unique features or the number of conflicts.**

| PR / branch | State at observation | Main...head | Changed paths (compare) | Consequence |
| --- | --- | --- | ---: | --- |
| [#96](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/96) `spaceverse/tenant-read-isolation-20260912` | OPEN / Draft / mergeable=false; head `febefa93f6a53c3b47db3a1fe2ec3ed727baaac8` | diverged: 194 ahead / 371 behind; merge base `1f5d0fd86663a4c65135616925cf09a91e682f04` | **141** | Old multi-domain branch; **do not merge/rebase wholesale** into product |
| [#165](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/165) `feature/kiosk-shifts` | OPEN / Draft / mergeable=false; head `d982913eaa5703a00ac388a739d23bcaa5af49ab` | diverged: 40 ahead / 538 behind; merge base `2036855abb3c04202d262613e7f02055b6f91bac` | **62** | Separate kiosk/device signing and migration review; **no installation on real device** |
| [#296](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/296) | MERGED Oct 29; head `066093a1` | `head` ancestor of main: 0 ahead / 169 behind | 0 from main...head | **Do not reapply** CRM empty DB bootstrap |
| [#299](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/299) | MERGED Oct 29; head `cd2e4ba6` | ancestor: 0 ahead / 108 behind | 0 | **Do not reapply** Marketplace inbox/CRM pagination |
| [#302](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/302) | MERGED Oct 29; head `d44b6ae5` | ancestor: 0 ahead / 24 behind | 0 | **Do not reapply** owner-proof preparatory code |
| [#312](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/312) | MERGED Oct 29; head `41f7da3c` | ancestor: 0 ahead / 8 behind | 0 | **Do not reapply** unmounted license policy |

**Important distinction:** these merged heads being ancestors proves source integration. It does **not** prove enabled production migrations, E2E, a provider-approved binding or a live license.

## #96: break up, don't import a composite root gateway

GitHub `list_pr_changed_filenames` confirms 141 paths, including:
- `authorization-membership.js`, `authorization-middleware.js`, customer 360 modules, customer actions/bonus adjustments, dashboards, transaction readers, scope directory and their tests;
- `server.js`, `universal-server.js`, `package.json`: dangerous cross-runtime integration surface requiring an independently scoped diff, Do-not-break parity review and tests;
- root manual `migrations/010_spaceverse_customer_metadata.sql` and `011_spaceverse_scope_directory.sql`. Current main already contains other files in those numbered slots, including `011_halloween_raffle.sql`. Similar numeric prefixes are a **migration ordering/history review requirement**, not proof that either migration is safe or applied. Do not rename, run or backfill either SQL in this coordination task.

**Already being decomposed by CHAT 02:**
- [Draft #339](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/339), head `a907f8c2ec08fb257d380fb4201ff15ff0d52aed`: specifically `authorization-membership.js`, `authorization-middleware.js`, corresponding two tests, and `ops/chat-02/pr96-decomposition-12.md` (5 files).
- `main...#339` compared cleanly as **5 commits ahead / 0 behind** as of this run. `mergeable=true` is not safety/approval; release gate was **in progress** when checked and local tests were not run in this coordinator session.
- These four code/test files overlap PR #96 exactly by path. The workstream's own checkpoint asserts exact blob comparison with #96, but CHAT01 did **not** independently byte-compare all four blobs. Confirm before selecting any subsequent slice.
- #339 is not an automatic fix for Admin Platform tenant scope, nor proof that `server.js/universal-server.js` handlers consume the helper. CHAT02 should own code fixes and negative PostgreSQL/HTTP tests; CHAT01 owns integration review only.

Other queried remote branches: `spaceverse/crm-tenant-reader-20261018`, `spaceverse/business-tenant-content-boundary-20261009`, `spaceverse/operations-tenant-remount-20261011-1015`, `audit/chat02-tenant-boundaries-20261101`. Their existence is **not** a verified dependency or missing implementation; compare exact branch HEAD and files before opening a new overlapping PR.

### Minimum safe #96 integration protocol

1. Hold #96 as Draft/historical source. Do not mass-rebase 194 commits / 141 files.
2. Isolate *one* owned security or tenant boundary per dedicated PR on fresh main, checking for already merged equivalents and open CHAT02 PRs.
3. Verify absent cross-tenant data leakage with denial cases for another company, another venue and another customer plus direct raw HTTP + native PostgreSQL where applicable.
4. Explicitly inspect actual route consumers and duplicate server handlers; update `ops/MODULE-MAP.md` with any related implementation PR.
5. Require double `materialize`, tests, check, audits, CI and reviewer approval. Separate customer-actions/money handling from read-only tenant work.

## #165: kiosk shift module is not the current Android release

The 62 changed paths include the **entire** `android-kiosk/` source subtree, `kiosk-shifts/`, `device-auth-*.js`, two root numbered migrations (`011_bar_kiosk_device_auth.sql`, `012_kiosk_shifts.sql`), `scripts/apply-kiosk-device-auth.mjs`, `scripts/apply-kiosk-shifts-migration.mjs`, `universal-server.js`, `package.json`, `.env.example` and Android Actions workflows. Github `contents` GET for `android-kiosk/` and `kiosk-shifts/` on current main returned **404**: those specific directories are **not on pinned main**. They *are* present on `feature/kiosk-shifts`.

Current main already includes `migrations/011_halloween_raffle.sql` and `012_evotor_sales.sql`; number/name conventions between root migrations are a migration sequencing collision risk. **No migration was executed**, and the precise migration loader constraints were not audited in this task.

**Signing P0, additional evidence (do not reinterpret as passed):**
- `android-kiosk/RELEASE-SIGNING-PLAN.md` and `.github/workflows/android-kiosk.yml` are available on the **draft branch**, but both paths were 404 on pinned main.
- Draft workflow visibly uses a cached debug keystore keyed `pivnik-kiosk-debug-keystore-v2` and creates a debug keystore when unavailable. The draft plan says an in-place device update had once succeeded. This is a **historical assertion in draft documentation**, *not* current certificate fingerprint proof.
- No live device SHA-256, previously installed APK signature, keystore backup inventory, or two independent restored backups were obtained. **Do not generate a fresh signing key, flash the draft APK or factory-reset the device.**
- GitHub Actions query at PR #165 head `d982913e` returned **0 workflow runs**; not proof of a successful regression.
- Signing, shift database, authenticated kiosk API and endpoint routing need separable acceptance paths. Avoid running `apply-kiosk-*.mjs` without fully understanding the migration workflow and effects on real data. Preserve main until explicit device compatibility proof and authorized rollout.

Other kiosk remote branches exist: `feature/android-bar-kiosk`, `docs/kiosk-release-signing-*` and `docs/kiosk-signing-plan-main-20261005`. Their existence cannot substitute for the **installed certificate**.

## Other agents / parallel work boundaries

| Existing Draft PR | Owner scope at observation | Evidence boundary | CHAT01 action |
| --- | --- | --- | --- |
| [#339](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/339) | CHAT02 auth fail-closed carve-out from #96 | 5 files, not wired to all runtime routes; CI in progress | Review after CI, don't copy changes into coordinator branch |
| [#340](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/340) | CHAT04 navigation through existing onboarding wizard | 4 paths: `VenueOnboarding.tsx`, its CSS and Playwright test, own checkpoint; CI in progress at snapshot | Don't modify or duplicate wizard UI |
| [#325](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/325) | CHAT01 baseline | 1 documentation file, Draft | Independent predecessor, not merged |
| [#337](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/337) | CHAT01 CRM four-axis release matrix | 1 documentation file, Draft | Independent predecessor, not merged |

#96 and #165 share `package.json` and `universal-server.js` by changed-path name. This is an **integration overlap warning**, not line-level proof of a Git conflict. #339 shares its four code/test filenames with #96. #340 does not have file-level overlap with #339 by inspected filenames.

**Release / required gate:** on pinned main, [Pivnik release gate](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41257568138) is **FAILED** at read-only Railway secret check (`Error: Not Authorized`). The [VK parity workflow](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41257568169) is success. Do **not** bypass CI or treat historic [old #96 successful run](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/38337987544) as current compatibility proof. Other workstream [CHAT11 #335](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/335) already owns a CI authorization checkpoint.

## Release dependency order and decision rules

1. **No-go for automatic integration:** block deploy/merge while required main CI fails or unapproved account/tenant/finance/device changes exist. A Draft does not imply installation approval.
2. Resolve current required CI *authorization* in separately owned workstream; do not print/change secrets or remove gate to make it green.
3. Accept narrowly scoped tenant/auth corrections from CHAT02 only after native tests and review; old #96 remains an input source, not a merge-ready package.
4. Keep CHAT04 onboarding navigation and CHAT05/06 Evotor ownership/sales work separated, with actual provider/tenant constraints.
5. Handle #165 outside the commercial SaaS path, after installed signing identity, backups, explicit migration sequencing and isolated Android/HTTP tests.
6. Only after validated, reviewed dependencies: staged integration and *separately authorized* production deployment, real user scenarios, rollback.

## Checkpoint

- **Task:** CHAT01-03, **DONE: remote branch/PR dependency inventory**.
- **Main:** `c92ed7cd65f1a96d94363c2b7e212424ab078a73` at observation.
- **Own isolated branch:** `ops/chat01-origin-pr-dependencies-20261101`. **Change:** this Markdown only.
- **Personally verified:** main SHA and 72 open PRs; #96, #165, #296/#299/#302/#312 metadata; compare ancestry; changed paths; existing #339/#340 file lists; origin branch name inventory; main vs draft folder presence; branch signing plan/workflow content; sampled GitHub Action statuses; `ops/MODULE-MAP.md` / Do-not-break.
- **Not verified:** local git checkout/status/test outputs; Android device signature/backup; effective production flags; database migration history; real provider data; actual clean cherry-pick/conflict-resolution and end-to-end behavior.
- **Risk:** P0 kiosk key continuity & tenant read isolation; P1 failed required gate; P2 inter-PR concurrency and stale docs.
- **Next small action (CHAT01-04):** inspect *actual* current shared files/API contracts and call sites `server.js`, `universal-server.js`, Admin router, and conflicting workstreams; document owner and gate with no runtime edits.
- **No action on production:** no data change, CI config write, branch rebase or merge, APK release or migration. The previous two CHAT01 drafts remain independent.
