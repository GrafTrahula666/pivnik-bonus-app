# Scoped API fallback — 2026-10-06

Original base: `40de231c4abde8ad6075e246a425b1f6d26316d5`.
Current revalidated base: origin/main `a76f59e9aec2a3048258111f6a9900028ab7df8a`.
Read `ops/MODULE-MAP.md`; no applicable AGENTS.md found. Knowledge base
was read during the preceding inventory; the exact starter-pack.md remains unavailable.
Existing worktrees, remote branches, open drafts and CI were inspected before
selecting this stage. No unmerged implementation was imported.

## Inventory and selected gap

| Function | Existing implementation | Evidence / gap | Next step |
|---|---|---|---|
| Cash / Evotor | POS drafts #174, #176, #209–210; return/session checks #201, #203 | Isolated evidence, production sync unverified | Validate one POS read composition |
| Dashboard / CRM | Main directory and summary modules; #208 | Directory access states tested; card transition absent | Validate scoped card wiring |
| Customer 360 | Read draft #96; HTTP/SQL evidence #212 | Disabled or mounted too late returns HTML 200 before this fix | Mount only verified read endpoint before boundary in a separate stage |
| Bonus adjustments | Main persistence; #193, #195, #199 | Replay/audit evidence exists; full owner flow unverified | Verify one sensitive operation end to end |
| Telegram campaigns | Main campaign store and provider | Provider tests, real delivery unverified | Preview/retry scenario with fixtures |
| Achievements / frames | Main modules and routes | Manual tenant-scoped audit flow unverified | Check permissions and audit |
| Audit / rights | Membership modules; #195–197 | Scoped reads disabled by default | Preserve server isolation before rollout |

The confirmed regression is an unavailable `/api/spaceverse/...` request reaching
the app-document fallback and returning HTML with status 200. The boundary now
returns JSON 404 with `Cache-Control: no-store` before document handling. Owners
and clients can distinguish unavailable API functionality from a successful read.
This does not make Customer 360 available or authorize any sensitive operation.

Existing scoped routes must register before this boundary. Gateway has no direct
scoped route implementation; its existing proxy forwards the child's result.
Neither auth/staff/admin/leaderboard handlers nor the gateway are changed.

## Original verification

- Actual new server registration and actual existing gateway proxy are exercised
  over local HTTP. 41 requests cover GET/POST/HEAD unknown routes, two tenant paths,
  trailing slash, repeated fixture success, fixture 403/400/502, document fallback,
  adjacent namespace and unavailable child 503. Registered routes precede boundary.
- Auth, route results and session canonicalization in this test are fixtures;
  this is not a claim of production auth or tenant isolation validation.
- `npm run materialize` twice: both succeeded; all 410 tracked files byte-identical
  between runs. The guard remains present and the new test passes after materialization.
- Materialized `node --test`: 475 passed, zero failures. `npm run check`: passed.
- `npm audit`: exit 1, six inherited advisories (3 moderate, 2 high, 1 critical).
  package.json and lockfile are unchanged; the separate dependency fix is draft #213.
- Materialization-only edits restored from the pre-run byte snapshot; published
  scope is server.js, regression test and this report. No patch retirement.

No UI files changed, so desktop/mobile browser validation is not part of this
stage. Full production startup, authenticated live requests, real DB data and
provider delivery remain unverified. No production write, merge or deploy.

Next small stage: verify read-only Customer 360 registration before this boundary,
without enabling the composition's write endpoints.

## Follow-up on current main

Main advanced via merged #179 (dependency updates, tester-claims retirement and
UI work); those changes belong to main, not this PR. Reapplied only this PR's
three files in a fresh isolated branch; no unmerged work imported.

- Clean `npm ci --ignore-scripts`: passed against current main lockfile.
- Materialize twice: both passed, byte-identical across 411 tracked files.
- Materialized `node --test`: 476 passed; `npm run check`: passed.
- Fresh `npm audit`: zero vulnerabilities. This resolves the original audit
  blocker through changes already merged into main; this PR changes no dependencies.
- Original remote head `7bda8e3`: release gate failed only production dependency
  audit; automated tests and all preceding syntax/materialization checks passed.
  VK native hosting parity succeeded. Production steps were skipped.

Disposable adaptation of #212's verifier used main `a76f59e`, exact read draft
`e2c5e522bac74a4567f7cc47052c0f1b28abf320` and the new canonical server tail
from local checkpoint `017b06d` (same boundary and tail as this PR).
The complete extracted gateway callback, extracted auth and SQL repositories
passed 21 HTTP/PGlite cases with the draft read endpoint registered before the
actual boundary/document/error registrations. Three additional HTTP checks
confirmed disabled and late-mounted endpoints return JSON 404 through the proxy,
and an unmounted write route returns 404 directly. All three perform zero card
SQL. Six fixture table snapshots stayed identical. Only the read endpoint was
mounted; the full write/read composition was never enabled.

This is isolated composition evidence, not a complete internal router/startup
or production proof. Synthetic identities, reduced SQL schema and SELECT profile
adapter remain. No UI changes were added, so no new desktop/mobile claim.
Next: validate complete internal registration/startup with isolated dependencies
without enabling draft writes or connecting to production.


## Verification follow-up: current main and full SQL-backed read fixture

Verified main pin: `d4ec0c30a55a84653cf46711792aa48d16408d2f` (includes #217 and #219 Evotor). This PR carries only its own fallback, test and report; no unmerged Customer 360 source is included. The earlier verification sections remain historical evidence for their stated pins.

A disposable full internal process imported the unchanged Customer 360 read endpoint from #96 pin `e2c5e522bac74a4567f7cc47052c0f1b28abf320`; all 91 copied draft root JS files were byte-checked against that Git object. Actual materialized server.js, authRequired, getProfile and membership SELECT were used. Only the exact GET card route was authenticated/mounted ahead of the fallback. No scoped write composition, metadata reads or live providers were enabled.

PGlite ran actual initDatabase SQL (103 statements), followed by the permitted automatic migrations against empty memory. The required OriginalTopG migration recipient was synthetic. Migration 009 and the explicit membership-table contract were applied only to this in-memory fixture. Rows were synthetic, not real accounts or wallets.

47 HTTP assertions passed: repeat/HEAD card reads; owner tenant/location isolation; foreign-only and absent clients; staff, foreign owner, revoked membership and legacy admin denials; pagination and empty page; invalid ID/page; missing, malformed, unknown-user, expired and stale sessions; unavailable GET/POST/HEAD namespace routes and disabled card POST; legacy unauthenticated denies and document responses; genuine profile reads; injected card SQL failure/recovery and health DB failure. Scoped money remained null, cancelled history remained visible while cancelled/foreign/unattributed purchases were excluded from financial totals. Denied memberships executed no card repository SQL. All 34 public table snapshots were unchanged after requests; fixture startup/seed writes occurred before snapshots.

Disposable read fixture checks: materialize twice, 470 tracked files byte-identical; node --test 511/511; npm run check passed; npm audit zero vulnerabilities. Harness-only issues (missing wallet for synthetic migration recipient, absent fixture Git HEAD, duplicate draft tests and source-extraction anchor) were corrected before the final run; none was a confirmed product regression.

Limits: this is an in-memory PostgreSQL-compatible pg adapter, not network PostgreSQL/pooling/concurrency proof. Full public gateway and gateway/prestart migration orchestration were not started in the card proof. Existing gateway proxy/fallback parity is covered by the separate regression test. Synthetic Telegram only. No UI change, desktop/mobile card workflow remains unverified. Membership migration, trustworthy tenant attribution and wallet binding remain rollout prerequisites; no feature-ready claim.

| Function | Existing implementation | Evidence | Remaining gap | Small next step |
|---|---|---|---|---|
| Cash/Evotor | main pos/*, #217/#219; separate Business draft #210 | Existing SQL/unit tests | Live receipt/sync not proved | Read-only device receipt evidence |
| CRM/Customer 360 | main directory; #208 access states; #96/#115 card drafts | 47 full internal HTTP cases on pinned #96 | Public gateway card and UI unproved | Read-only full gateway fixture |
| Bonus corrections | main persistence; #182–#199 validation/result drafts | Existing SQL/replay proofs | Complete scoped owner flow unproved | Review one pinned correction scenario |
| Telegram broadcast | main campaign store/provider adapters | Existing dedupe tests | End-to-end audience/error flow unproved | Isolated provider-failure fixture |
| Achievements/frames | main modules and manual operations | Existing module tests | Scoped grant/audit scenario unproved | Prove one scoped grant without live writes |
| Rights/audit | authorization membership/middleware and operation journals | Owner/staff/revoked/foreign denials in card proof | Membership schema/rollout not enabled | Confirm additive membership contract |

Next small step: attach only this pinned read endpoint to a disposable complete public gateway fixture, with all scoped writes disabled. This is a proposal, not completed work.

Rebased fallback-only PR validation on the same main pin: materialize twice passed with 472 tracked/new PR files byte-identical; node --test 511/511; npm run check passed; fresh npm audit zero vulnerabilities. Only server.js, this report and the fallback regression test are committed. The disposable Customer 360 mounting/adapters are excluded.
