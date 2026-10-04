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
