# Default-disabled wallet ownership executor boundary

Fresh base origin/main 18a0fa4e5d911952a7993c432a6e7fc50de9e8c5.
Branch feat/customer-wallet-guard-20261004. Worktrees/status/history/remotes/origin
branches/open PRs reviewed. Detached Business generated changes preserved; new
automation/admin-adjustment-input-guard branch points at main and adds no code.
MODULE-MAP read, no AGENTS.md found. Starter/knowledge base read earlier.
Previous evidence PR #196 4d33196 passed release gate 1699. No draft code imported.

| Function | Existing implementation | Verified evidence | Gap | Next step |
|---|---|---|---|---|
| Cash/Evotor | #174, Business #176 | Branch inventory | Real provider synchronization unavailable | Provider fixture reconciliation |
| CRM/Customer 360 | Main directory, #115, #96 | #196 pinned SQL verifier | Visibility does not prove wallet ownership | Independent financial boundary |
| Corrections | Main executor, #182–184/#193, #194 status, #195 journal invariant | Prior isolated proofs/green CI | No approved wallet binding or scoped executor | Disabled guard plus pinned isolated composition |
| Telegram | Main store/retry drafts | Main tests | Real provider flow unverified | Isolated retry |
| Achievements/frames | Main engine/Business grants | Main tests | Scoped grants unverified | Audited grant scenario |
| Rights/audit | Legacy main + disabled memberships/009 | Main tests/#194 | Approved actor/client provisioning absent | Verify authoritative binding before enablement |

## Change

Add createCustomerWalletAdjustmentGuard, a default-disabled optional function for
the existing Customer 360 executeAdjustment injection point. No new Customer 360
runtime or ownership SQL implementation. No production route/migration/activation.
It requires transaction runner, independent ownership assertion and executor.
Enabled mode snapshots an allowlisted frozen command/audit; canonical bigint IDs,
bounded scope, nonzero safe amount, reason and existing REQUEST_KEY_PATTERN checked
before transaction. Unknown caller fields/claimed ownership/audit ignored.

Ownership assertion and executor receive the same transaction object and immutable
command. Only literal true proceeds; absent/ambiguous proof, SQL outage and execution
failure propagate. Every repeat checks ownership anew and preserves the original key;
guard implements no cache, new key, wallet arithmetic or replay mechanism.

Trusted composition MUST authenticate/bind actor and fresh owner/platform rights,
run BEGIN/COMMIT/ROLLBACK, query and lock an authoritative wallet binding inside that
transaction (including revocation/merge semantics) and execute financial replay/
wallet/journal operations using that transaction. A callback cannot be considered
authoritative just because it returns true. Transaction runner/executor can violate
their contract; guard does not independently enforce their SQL or locks. No approved
binding implementation exists, so enablement remains blocked. Guard is composed with the pinned Customer 360 service ONLY in the manual
isolated verifier below, never in production. This is a concrete integration
boundary, not proof of production tenant isolation or a ready financial feature.

## Verification

Six unit cases: default gate/config; invalid commands before transaction; same object
and proof-before-execution/repeated key; strict denial/authority outage; frozen original
snapshot despite caller mutation/spoofed audit; executor/transaction failure.
One real sequential PGlite case with explicitly fixture-only binding/wallet/journal
tables: credit/debit, foreign tenant/location/client, binding revocation, SQL outage,
duplicate INSERT error after wallet update rolls back. Fixture executor is NOT main's
financial executor and duplicate failure is not a successful idempotent replay.
Independent concurrent PostgreSQL, real lock/revocation contention, signed actor/
membership remain unverified. Existing Customer 360 composition is verified
only in the explicitly isolated fixture below. No UI change.

Full materialized node --test 443/443 (436 main + 7), canonical focused 7/7.
Final materialize twice tracked/new SHA256 identical; check, VK startup parity,
explicit syntax/diff-check pass. Audit retains the existing three moderate findings
(#180). Public read-only probe initially VK timed out (Telegram responses); bounded
repeat at 2026-10-04T08:07Z responds 16/16. Deployed main18a0fa4 and
DB health OK; no root-cause inference. Generated runtime changes restored.

## Isolated composition follow-up (2026-10-04)

Added scripts/verify-customer-wallet-guard-composition.mjs, an explicit manual
verifier, not a startup/CI step. It reads the existing Customer 360 implementation
from pinned git object e2c5e522bac74a4567f7cc47052c0f1b28abf320 (#96), copies its
six modules to a disposable directory, emits their SHA256 hashes and removes the
directory after execution. No foreign implementation is included in this branch.
Requires that pinned object locally (fetch the existing branch before running).
Run: node scripts/verify-customer-wallet-guard-composition.mjs.

Uses real pinned users/wallets/transactions DDL and migration 009 solely in PGlite.
Fixture wallet binding and financial executor are diagnostic adapters, NOT proposed
production schema or the existing main HTTP executor. Pure owner/staff contexts
are fixtures, not authenticated identities. Sequential embedded SQL does not prove
independent PostgreSQL locking or concurrent revocation correctness.

18 named checks passed: two tenants can read the same customer; default wallet gate
fails before transaction; the second visible tenant cannot adjust the wallet;
foreign client/location, mismatched owner scope, staff rights, zero amount, absent
confirmation, invalid original key and missing reason fail before transaction;
credit/debit commit; duplicate original key rolls back wallet/journal (NOT successful
idempotent replay); revocation denies repeated/new keys despite history; ownership
outage and real journal SQL failure leave wallet/journal unchanged; pending/cancelled
history cannot replace authoritative binding. Fixture balance 999 -> 1024 -> 1014;
rejections compare full wallet and journal snapshots.

Fresh origin/main remains 18a0fa4. Previous PR #197 release gate 1700 passed.
Full materialized node --test again 443/443, materialize twice with SHA256 equality
across 398 tracked/new files. Check, explicit syntax and startup parity pass.
Audit still three pre-existing moderate findings; no new dependencies. UI unchanged.
Public read-only probe: 16/16 responses; log completed 2026-10-04T09:10:51+00:00.
Signed sessions and provider flows are not exercised. No production writes/schema/config, merge or deploy.

Next bounded stage: compose with the actual main financial executor in the same
isolated harness and prove successful replay; keep production disabled until wallet
ownership/actor provisioning and lock/revocation contracts are independently verified.
