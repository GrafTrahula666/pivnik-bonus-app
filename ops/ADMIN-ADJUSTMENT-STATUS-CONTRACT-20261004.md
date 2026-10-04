# Scoped correction status evidence — 2026-10-04

Base: freshly fetched origin/main 18a0fa4e5d911952a7993c432a6e7fc50de9e8c5.
Branch: feat/admin-adjustment-status-contract-20261004, created from that main.
Remotes, history, worktrees, origin branches and open PRs reviewed. Detached
business-ci-verify generated changes preserved; other worktrees clean. No
applicable AGENTS.md found; ops/MODULE-MAP read. Starter pack and SaaS knowledge
base were read earlier and remain the working brief. No foreign draft included.

## Inventory and selected stage

| Function | Existing implementation | Verified evidence | Concrete gap | Next small step |
|---|---|---|---|---|
| Cash/Evotor | #174, two dashboards; Business #176 | Branch/PR inventory | Real receipt synchronization unavailable | Reconcile dedup/returns with provider fixtures |
| CRM | Main admin directory; pagination draft | Existing main regression suite | Legacy global roles | Scoped read integration |
| Customer 360 | #115 and tenant read isolation #96 | Branch/PR inventory | Not integrated/enabled | Review existing scoped contracts |
| Bonus correction | Main route/persistence; #182–184, UI #193 | Prior SQL/browser proofs; #193 gate 1690/parity 598 passed | No safe read-only pending-command status | This isolated scope/status contract |
| Cancellation | #185–189; joint verifier #191 | Prior SQL/browser proofs | Drafts unmerged | Review prepared stages |
| Telegram | Main campaign store/retry drafts | Existing tests | Real provider delivery unverified | Isolated transient-retry scenario |
| Achievements/frames | Main engine/personal frames; Business grants | Existing tests | Tenant grant flow unverified | Audited scoped grant scenario |
| Rights/audit | Main legacy roles + authorization/attribution foundation | Existing tests and this isolated reader | Migration 009 and runtime membership wiring disabled | Verify trusted scope resolution before route integration |

The existing finite admin history strips requestKey/clientId/staffId; absence
from recent results cannot prove that a financial command never committed. #193
already handles unknown results and reload recovery, so it is not reimplemented.
The next useful bounded stage is testable server evidence, not speculative
history matching or a new globally authorized read endpoint.

## Implemented contract

admin-adjustment-status.js exports createAdminAdjustmentStatusReader, disabled
by default. It reuses main authorization-context and request-key validation.
The caller must provide a server-resolved authorization context, authenticated
session actor and explicit tenant/location after verifying additive migration
009. Legacy admin/viewer roles do not imply tenant membership. Only a tenant
owner or explicit platform admin can call it; even platform admins retrieve
only their own command. Staff and foreign tenant owners fail before SQL.

One parameterized SELECT filters tenant/location/actor/client/requestKey. It
projects only evidence fields and checks returned scope defensively. It compares
mode, amount and reason before accepting completed evidence. Responses:

| Evidence | State | May clear pending command |
|---|---|---|
| Exact completed adjustment, valid bounded integer balance | confirmed | Yes, based on the immutable operation result |
| Matching cancelled adjustment | cancelled | No; reconciliation required |
| Different command semantics under same scoped key | conflict | No |
| Missing row or other non-final status | unknown | No |
| Disabled feature, forbidden scope, malformed result, SQL failure | Exception | No confirmation |

balanceAfter is the historical operation result, explicitly not the current
wallet balance. Unknown never permits a new request key: concurrent writes,
replica lag and legacy unattributed rows can all hide a committed result. No
legacy fallback, tenant inference, schema backfill or write occurs.

## Validation and limits

Tests cover default-disabled behavior, permissions, invalid command/IDs, exact
confirmation, pending/declined/expired/cancelled/conflicting evidence, malformed
and out-of-scope driver results, unsafe balances and SQL outages. Real sequential
PGlite uses the main legacy CREATE TABLE statements plus actual additive
migration 009, only inside disposable fixtures. Credit/debit repeated reads
leave full wallets/journal snapshots unchanged. A deliberately different current
wallet (999) proves the returned 125/75 is historical. Foreign tenant/location/
actor/client queries and legacy unattributed rows reveal no evidence. A missing
migration raises SQL error rather than falling back to global history.

No production wiring or UI changes: desktop/mobile are not applicable to this
module. No admin/auth/staff/leaderboard routes changed; both server files remain
byte-identical to main after generated materialize output is restored. The
trusted authenticated-actor/context integration is still the caller's boundary,
not proven by this repository module. Production tenant isolation, concurrent
PostgreSQL, signed VK/TG entry and Selectel server diagnostics remain unverified.

No production writes/migrations, dependency/env/service additions, paid resources,
mass messaging, patch retirement, merge or deployment. The panel itself does not
yet expose this status reader. This prepares exact recovery evidence for the
owner; it does not claim that the user-facing recovery workflow is complete.

Next small stage: verify server-resolved actor/membership scope on an isolated
HTTP adapter before production route wiring; prohibit legacy global-role bypass.

Completed checks: 11/11 focused canonical tests; full materialized node --test
447/447 (main baseline 436 plus 11 new tests; #193 is deliberately not imported).
Double materialize has identical hashes of all tracked and new source files.
npm run check, explicit new-module syntax and VK startup parity pass. npm audit
retains the existing 3 moderate HTTP dependency findings, addressed separately
in draft #180. Fresh read-only runtime probe: 16/16 responses; deployed commit
remains 18a0fa4. Generated runtime files restored; server.js/universal-server.js
have no changes relative to main. UI unchanged, so no new browser claim.

## HTTP session and membership adapter — 2026-10-04 follow-up

Fresh main still 18a0fa4. Open PRs/origin branches, remotes/history and all
worktrees reviewed again. Detached business-ci-verify generated modifications
preserved; no AGENTS.md found; MODULE-MAP read. Prior #194 head 8e4d1dc passed
release gate 1691. The same branch/PR continues one related status scenario.

Added unmounted admin-adjustment-status-handler.js, default disabled. It obtains
actor and optional platform role exclusively from authenticated req.user. Route
parameters specify the requested tenant/location/client; the actual existing
membership resolver evaluates fresh SQL memberships for that actor. Only its
context is forwarded to the scoped status reader. Body/query/header authorization
claims are ignored. Existing compatibility middleware's legacy-capability path
is deliberately not used for this new scoped adapter. Responses forbid caching.
No real route is registered in server.js or universal-server.js.

HTTP integration tests use actual main authRequired, platform-core HMAC session
signing/verification and effective identity role logic, plus actual membership
SQL repository/resolver, status reader and new handler. They run over real local
HTTP and sequential PGlite. Main legacy DDL and migration 009 are used in the
isolated fixture. The membership table is explicitly test DDL matching the
existing repository contract; there is no approved production migration for it.
getProfile is a small SQL fixture projection, with a fixture-only platform-admin
mapping, not proof of live platform-role assignment or complete production auth.

Tests demonstrate exact confirmation/repeated read with wallet/journal unchanged;
forged actor/context/role/tenant claims cannot turn staff, foreign owner, revoked
owner or global legacy admin into tenant owner. Platform admin cannot impersonate
the operation's actor. Wrong location/client reveals only unknown. Empty, bad
signature, expired and stale-version sessions fail before membership/status SQL.
Invalid input, semantic conflict, membership outage and missing membership table
cannot confirm. Membership revocation after a successful read is respected on
the next HTTP request. Default-disabled adapter avoids membership/journal reads.

This is preparation for safe owner recovery, not a completed panel feature.
Production mounting, verified membership migration/provisioning, trusted live
profile/context binding, gateway handling and UI status integration remain
unverified. No production data, schema, routes, dependencies or deployment changed.
UI unchanged; no desktop/mobile claim added. No merge/deploy or patch retirement.

Follow-up checks: 8/8 HTTP cases plus 11/11 reader cases on canonical sources;
full materialized node --test 455/455 (436 main + 19 isolated status tests).
Double materialize tracked/new-source hashes identical; npm run check, explicit
adapter/test syntax, diff-check and VK startup parity pass. npm audit remains
3 existing moderate findings (#180). Fresh read-only production probe: 16/16;
deployed commit remains 18a0fa4. Generated server/runtime changes restored before
commit, with no server.js/universal-server.js changes relative to main.

Next bounded verification: forward this isolated HTTP status adapter through the
actual local gateway proxy and verify session identity/error parity. Production
activation still requires an approved membership schema/provisioning and verified
attribution; those are not silently supplied by the test fixture.


## Local gateway verification — 2026-10-04 follow-up

Fresh origin/main remains 18a0fa4; all remote branches/open PRs/worktrees and
history reviewed. Existing detached generated changes preserved; no AGENTS.md
found. Previous #194 head 99828f7 passed release gate 1692. Continue the same
bounded status scenario, without incorporating #193 or other draft code.

Changed only the HTTP integration test and this report. The optional gateway
fixture executes actual canonicalizeSessionToken, readRequestBody, sendJson and
proxyRequest extracted from universal-server.js, actual HMAC verification and
SQL users/session-version reads. A real loopback HTTP gateway forwards to the
existing Express/auth/membership/status fixture. Top-level dispatch, process
startup and the exception-to-503 wrapper remain fixture wiring; this does not
claim coverage of the entire deployed gateway. Production getProfile/platform
role binding and approved membership storage remain outside the fixture proof.

Five new cases exercise both VK and Telegram signed sessions. Repeated credit
and debit reads preserve complete wallet/journal/membership snapshots and return
historical balances. Gateway SQL validates the signed actor; forged body/query/
header claims, foreign owner, staff, revoked owner and legacy global admin cannot
confirm. Foreign tenant fails; wrong location remains unknown. Invalid command
and changed reason fail or conflict. Empty, tampered, expired and stale sessions
are rejected without membership/journal reads; an invalid staff-session header
is rejected by the real proxy. Revocation is loaded afresh. Membership/session
SQL outages and an actually closed upstream listener cannot confirm; upstream
failure returns the real proxy's 502 response. No SQL writes occur outside setup
and explicit fixture revocation.

Full materialized node --test: 460/460 (436 main + 24 status tests). Double
materialize hashes identical; npm run check, VK startup parity and diff-check
pass. npm audit: unchanged 3 moderate findings, separate #180. Generated runtime
files restored; server.js and universal-server.js unchanged relative to main.
UI unchanged; desktop/mobile is not newly exercised. Sequential PGlite is not
independent concurrent PostgreSQL. No production writes/schema changes, new
services/dependencies/env variables, merge, deployment or patch retirement.

The panel itself still has no status endpoint or UI: this verifies a prerequisite
for safe owner recovery, not a completed user-facing feature. Activation remains
blocked on approved membership migration/provisioning, verified tenant attribution
and trusted production profile/context binding. Next bounded stage: verify that
profile/platform rights binding on isolated SQL before considering route mounting.

Canonical focused rerun after restoring generated files: 24/24. Read-only
production observation at 2026-10-04T01:01–01:02Z (04:01–04:02 Moscow): both
initial and bounded repeat reach 8/16 responses. Telegram's eight public URLs
respond, DB health is OK, release remains 18a0fa4. All eight VK Railway URLs
time out from this execution network. This is a new reachability observation,
not proof of a global outage or of its cause, and does not test Selectel itself.
Server/network logs are unavailable. It is independent of these unpublished,
unmounted test changes; no live financial calls or data mutations were made.


## Main profile SQL / rights projection — 2026-10-04 follow-up

Freshly fetched main remains 18a0fa4. Remote branches, open PRs, remotes/history
and worktrees rechecked; detached generated work preserved. MODULE-MAP read,
no applicable AGENTS.md found. Prior #194 c75c612 passed release gate 1693.
No foreign draft code incorporated. Only test fixture and report changed.

Added an opt-in fixture that extracts actual server.js getProfile SQL and return
projection and runs it through actual authRequired, gateway and scoped status
adapter. It uses actual personal-frame ownership SQL and legacy beer_loyalty /
beta_grants DDL. user_frames / reward_grants read columns and memberships are
explicit fixture DDL. Personal gift/frame mutators, achievement/spend/status and
appearance dependencies are explicit stubs; this is not full live getProfile.
Older fixture-only platform-admin mapping is not used by the new four cases.

Both VK and Telegram confirm repeated owner status using an actual SQL profile
whose legacy role is client but whose SQL tenant membership is owner. The
profile has no platformRole field. A legacy admin formerly given artificial
platform rights by the older fixture is denied with actual main projection,
even when body claims platform_admin. A signed configured owner identity is
promoted by actual authRequired only to legacy admin and still receives 403
without membership. Removing that actor's wallet makes the actual profile JOIN
return no row and authentication returns 401 before membership/journal reads,
even after adding an active membership. Successful/denied reads preserve fixture
wallet, journal and membership snapshots. No global role-to-tenant inference.

Concrete activation gaps discovered by source inspection:
- Main getProfile does not provide trusted platformRole: explicit platform-admin
  provisioning/resolution is unimplemented, not supplied by this test fixture.
- Main authRequired invokes getProfile, which calls applyOlesyaGift and
  applyVladislavFrame before SELECT. Eligible personal gift code can update the
  wallet/journal and frame code can update users. This existing behavior was
  not changed; full production authentication cannot be called read-only based
  on these tests with explicit mutator stubs. The new status route must have a
  read-only identity boundary before activation.
- Approved membership schema/provisioning and verified attribution remain
  prerequisites. No production endpoint/UI is mounted by this PR.

Initial canonical tests passed, but the first materialized run failed four new
cases because its getProfile additionally SELECTs reward_grants. Adding the
explicit fixture read schema repaired the test harness; product code unchanged.
Next bounded stage: isolated read-only session/identity boundary for this status
adapter, without changing legacy auth or implicitly granting platform rights.

Final checks: materialized node --test 464/464 (436 main + 28 status cases);
canonical reader/HTTP/gateway/profile rerun 28/28 after restoring generated
runtime files. Final double materialize tracked SHA-256 identical. npm run
check, VK startup parity, explicit syntax and diff-check pass. npm audit still
reports the same 3 moderate findings (#180); no dependencies changed.
Fresh read-only public probe 2026-10-04T01:59Z (04:59 Moscow) responds 16/16,
both DB health reports OK, deployed release remains 18a0fa4. Previous VK
Railway timeouts are not reproduced in this observation; Selectel and signed
live owner workflow remain unverified. UI unchanged, no desktop/mobile claim.
No production data/schema/routes changed; no merge/deploy or patch retirement.


## Read-only status identity boundary — 2026-10-04 follow-up

Fresh origin/main still 18a0fa4. Worktrees/status/history/remotes/remote branches
and open PRs reviewed; detached generated changes preserved. MODULE-MAP read;
no AGENTS.md found. Previous #194 c532f5a passed release gate 1694. Same bounded
status PR continues; no foreign draft implementation copied.

Added admin-adjustment-status-auth.js, unmounted/default-disabled. Its factory
requires a trusted session verifier and query function plus explicit boolean
enablement. It clears any pre-existing req.user/session and forbids caching.
Only a bounded Bearer user session with known VK/TG platform, canonical bigint
string uid, positive safe integer session version and no staff/other kind passes.
Staff-session headers are rejected rather than resolved into a different actor.
The actual platform-core verifier checks HMAC/expiry in the isolated integration.

One parameterized SELECT reads id/session_version of the active, unmerged user;
it checks driver evidence and version before publishing frozen {id} and a minimal
session. It does not call getProfile, SELECT a wallet, calculate rewards, load
appearance or issue a gift. Signed payload/body/header legacy or platform roles
are not copied. Tenant authorization remains the existing fresh membership SQL
resolver; this boundary does not grant platform-admin access. Missing/stale
identity returns 401; malformed driver evidence/SQL failures propagate to the
caller error handler without an identity. Disabled gate does no verification/SQL.

Three unit cases cover configuration/default gate, invalid/out-of-scope driver
rows/duplicates/outages, parameterized read and minimal immutable identity. Five
HTTP cases add both VK/TG repeat confirmation with a gift-eligible actor name,
no profile/reward queries, no wallet dependency for authentication, signed role
spoofing rejection, invalid subjects/staff/unknown platform, fresh session-version
revocation and renewed version, fresh membership revocation, SQL outage and
default-disabled behavior. Full users/wallet/journal/membership snapshots stay
unchanged outside fixture setup and explicit revocations. A signed bigint beyond
PostgreSQL's range fails in the existing gateway's earlier SQL as fixture 503,
before this middleware can issue 401; it never reaches membership/status SQL.
That existing gateway behavior is recorded, not changed in this stage.

This removes the profile-mutator dependency from the isolated recovery chain.
No actual route is mounted in either server; production status/UI remains
unavailable. Membership migration/provisioning, attribution and an approved
platform-admin assignment are still missing. Sequential PGlite is not concurrent
PostgreSQL; real signed launch/top-level gateway startup remain unverified.
UI unchanged, no new desktop/mobile claim. No production data/schema changes,
dependencies/services/env variables, paid resources, merge/deploy or retirement.
Next bounded stage: pin and review the tenant attribution/membership activation
prerequisites before any production mounting; do not silently supply them from
fixture DDL or infer them from legacy global roles.

Validation: full materialized node --test 472/472 (436 main + 36 status cases),
canonical focused rerun 36/36 after restoring generated output. Double materialize
tracked/new-source hashes identical; check, VK startup parity, explicit syntax
and diff-check pass. npm audit: same existing 3 moderate HTTP findings (#180).
Fresh read-only public probe at 2026-10-04T03:02–03:03Z (06:02–06:03 Moscow):
initial 15/16 (VK /api/health timeout); bounded
repeat 16/16, both DB health OK/release18a0fa4. This observation does not test
Selectel or the signed production owner workflow. No live financial requests.
Generated server files restored and byte-identical to main before commit.
