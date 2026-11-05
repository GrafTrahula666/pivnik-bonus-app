# Customer visibility and wallet ownership evidence

Fresh base origin/main 18a0fa4e5d911952a7993c432a6e7fc50de9e8c5.
Branch test/customer-wallet-scope-evidence-20261004. Worktrees, status, history,
remotes, origin branches, open PRs/CI checked; detached Business generated changes
preserved. No AGENTS.md found; MODULE-MAP read. Starter/knowledge base read earlier.
Prior #195 ddaf74d passed release gate 1698. No unmerged implementation imported.

| Function | Existing implementation | Verified | Concrete gap | Next step |
|---|---|---|---|---|
| Sales/cash | #174 Evotor, #176 Business | Branch/PR inventory | Real synchronization unavailable | Provider fixture validation |
| CRM/Customer 360 | Main directory, #115; #96 scoped foundation | Current isolated scope verifier | Visibility is not wallet ownership | Require authoritative wallet binding |
| Bonus corrections | Main executor; #182–184/#193; #194 status; #195 invariant | Earlier proofs and #195 green CI | Scoped execution lacks wallet ownership proof | Harden existing disabled Customer 360 composition |
| Telegram | Main campaigns/retry drafts | Main regression tests | Provider delivery unverified | Isolated retry test |
| Achievements/frames | Main engine/Business grants | Main tests | Scoped grants unverified | Audited grant flow |
| Rights/audit | Main legacy plus disabled memberships/009 | Main tests, isolated #194 | Approved provisioning/attribution absent | Verify trusted binding before enablement |

## Existing implementation found, not recreated

Pinned #96 source e2c5e522bac74a4567f7cc47052c0f1b28abf320 already has
customer-bonus-adjustment-service/runtime and Customer 360 read repository.
Runtime uses isCustomerVisible as its pre-execution proof. Read repository explicitly
documents transaction footprint as visibility, NOT wallet ownership, and suppresses
scoped global wallet balances. The bonus runtime nevertheless delegates a mutation
after that same history existence check. Global wallets are user-keyed, not tenant-keyed.
Main has no authoritative customer-wallet tenant binding; migration 009 adds only
nullable transaction attribution. Migration 010 metadata explicitly forbids using
events to infer ownership. Business #176 company/venue ACL protects venue access,
not ownership of the legacy global client wallet. No approved mapping found.

Added only an explicit manual verifier that reads pinned git objects into a disposable
temporary module directory, runs the original draft modules and deletes that directory.
No draft production files enter this branch. Source SHA256 hashes appear in its output.
If the pinned git object is absent, fetch the existing branch first; no fallback to
changed code, test skip or network download is attempted by the verifier itself.

Reproduce:

```
git fetch origin spaceverse/tenant-read-isolation-20260912
node scripts/verify-customer-wallet-scope-evidence.mjs
```

Actual pinned legacy DDL + migration 009 execute only in disposable PGlite. Fixture
client20 has one global wallet999 and transactions in tenant-a/tenant-b. Injected
owner contexts for both tenants reach the recording executor for that same wallet.
Changing tenant-a history to pending or cancelled still reaches it. Four delegations
recorded; actual financial executor is deliberately absent and no wallet is mutated.
Foreign client/location/context, staff, zero amount, missing confirmation, disabled
scope and SQL outage reject without delegation. All runtime query calls are SELECT.
Full users/wallets/journal snapshots match after restoring only fixture status changes.
13 explicit input cases plus snapshot/query assertions. Identity contexts are fixtures,
not signed sessions; no claim of an authenticated production exploit or financial write.

## Consequence for the next stage

Validation: node --test 436/436 main regression cases after materialization; manual
verifier passes 13 input cases both before and after restoring canonical runtime.
Materialize twice tracked/new SHA256 identical; check, VK startup parity, explicit
script syntax and diff-check pass. Audit retains main's three moderate findings
(#180). Public read-only probe 2026-10-04T07:05Z (10:05 Moscow) 16/16, deployed
main18a0fa4, DB health OK. Generated runtime changes restored before commit.

Historical visibility cannot authorize altering a global wallet. Existing disabled
Customer 360 composition must require a separate authoritative wallet ownership proof
and perform it inside the financial transaction before mutation, with trusted actor,
fresh owner rights and scoped replay matching. Never infer exclusive ownership from
transactions, tags, provider links or a legacy global role. Do not invent or apply a
mapping/backfill until its provisioning/merge/revocation semantics are approved.

This is a reproducible activation blocker in unmerged code, not a production incident.
Current panel receives no new function. Production SQL, signed workflow, Selectel,
concurrent PostgreSQL and real wallet tenant isolation unverified. UI unchanged.
No production data/schema/config change, dependencies, merge or deploy.

Next bounded stage: add a default-disabled, mandatory independent wallet-binding
boundary to the existing Customer 360 runtime without supplying a guessed mapping.
