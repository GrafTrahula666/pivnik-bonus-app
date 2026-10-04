# Completed-state invariant for admin adjustment replay

Fresh fetched origin/main: 18a0fa4e5d911952a7993c432a6e7fc50de9e8c5.
Branch fix/admin-adjustment-replay-status-20261004 starts directly from that base.
Worktree list, status, remotes, history, origin branches and related open PRs
reviewed. #197 release gate 1701 passed. New claude/project-thread-me1i25 branch
contains unrelated changes; none imported. Existing dirty Business worktree preserved.
MODULE-MAP read previously and main version unchanged; no applicable AGENTS found.
Starter pack and SaaS knowledge base read earlier; no new requirements inferred.

| Function | Existing implementation | Verified | Specific gap | Next small step |
|---|---|---|---|---|
| Cash/Evotor | #174, Business #176 | Branch inventory, prior fixtures | Live provider flow unavailable | Provider reconciliation fixture |
| CRM/Customer 360 | Main directory, #115/#96 | #196/#197 isolated SQL evidence | History is not wallet ownership | Authoritative binding before activation |
| Bonus corrections | Main HTTP handler; #182–195 drafts | Main HTTP/SQL and gateway transport in this PR | Cancelled correction returned success | Completed-state check + proxy proof |
| Telegram | Main store/retry drafts | Existing regression tests | Live campaign not tested | Isolated provider retry |
| Achievements/frames | Main engine, Business grants | Existing regression tests | Scoped grants not established | Audited grant scenario |
| Rights/audit | Legacy roles + disabled membership foundation | Existing tests and fixture role middleware | Production tenant/actor provisioning unverified | Approved binding/membership evidence |

## Reproduced regression and fix

On unmodified main, an exact repeat of a cancelled bonus correction returns
HTTP 200 / ok:true / replayed:true and its historical balance_after, even when
cancellation has already reversed the wallet. Regression test failed: 200 != 409.
Other completed replays, conflict checks and SQL rollback cases passed initially.

The actual /api/admin/users/:id/adjust handler now validates stored status after
matching original key/client/actor/amount/reason and before success. Any state other
than completed rolls back the read transaction and returns HTTP 409 with
ADJUSTMENT_NOT_COMPLETED. It never executes the original correction again and does
not generate a replacement key. Completed credit/debit replay preserves its exact
historical result even after a subsequent operation changes current balance.

This prevents the owner's repeated request from falsely confirming an already
cancelled correction. It does not add a status endpoint or enable tenant wallets.

## Verification and scope

New tests execute the checked-out real Express handler, role/auth middleware,
request-key advisory lock, replay comparison and persistence against PGlite with
real main users/wallets/transactions DDL. Session verification/profile loading are
explicit fixtures; no claim about signed production identities. Cancelled wallet
reversal is seeded SQL, not a test of the cancellation route itself.

Four focused cases cover completed credit/debit replay with full snapshots;
cancelled/pending/declined/expired rejection without writes; amount/reason/actor
conflicts, 401/403 and invalid input; real journal constraint error rolling back
wallet and succeeding with the same original key after recovery.

Canonical focused 4/4; full materialized node --test 440/440 (436 base + 4).
Materialize twice SHA256 identical across 394 tracked/new files; check, explicit
syntax, VK startup materialize/prestart parity and diff-check passed. No patch script
retirement. All generated runtime changes restored, retaining only the 7-line fix.

Gateway parity: universal-server.js has no direct adjustment handler; this POST
passes consent checking and proxyRequest to the patched Express route. Existing
startup parity passed; the follow-up below also tests actual proxy HTTP transport.

npm audit retains three pre-existing moderate findings, tracked separately by #180.
Public read-only probe 16/16; log completed 2026-10-04T10:02:36+00:00.
No signed production admin workflow, independent concurrent PostgreSQL, real
provider flow or production SQL inspection. UI unchanged, so desktop/mobile not
retested. Production data/schema/config, dependencies, services, merge/deploy untouched.

## Gateway transport follow-up (2026-10-04)

Fresh origin/main still 18a0fa4. Previous #199 release gate 1703 and VK native
hosting parity 600 passed. Open PR #198 contains unrelated changes; not imported.
Worktrees rechecked; detached Business modifications preserved.

Extended the same fixture with two local HTTP servers: real checked-out gateway
readRequestBody/sendJson/proxyRequest forwards to the real Express adjustment
handler. Wrapper controls readiness/port; token canonicalizer, session verification
and profile lookup remain explicit fixtures. VK actor 11 and Telegram actor 10
are preserved into the actual SQL journal. Proxy method, path, body and response
status/code are exercised with real HTTP, not a mocked fetch/SQL journal.

Six new cases (three per platform) prove completed credit/debit replay and historical
result, 409 with ADJUSTMENT_NOT_COMPLETED for cancelled/pending/declined/expired,
full wallet/journal snapshots unchanged on rejection, 401/403 and invalid input
before financial connection, SQL journal failure rollback and original-key recovery,
changed-command conflict, readiness 503 and closed upstream 502 without execution.

Canonical focused 10/10; materialized full node --test 446/446. Materialize twice
SHA256 identical across 395 tracked/new files; check, syntax, VK startup parity and
diff-check passed. Audit remains three old moderate findings (#180).
Public read-only probe: 16/16; log completed 2026-10-04T11:06:42+00:00.

Only tests/report extended; original 7-line route fix unchanged. Generated runtime
files restored. No UI, dependencies, production data/config, merge or deploy.

Scope: this is the actual proxy transport, not the full public request dispatcher,
consent checks, HMAC canonicalization or signed production authorization. Cancellation
reversal remains a seeded fixture; independent concurrent PostgreSQL unverified.

Next small stage: verify an actual cancel followed by repeat of the original
correction through the same isolated gateway, with audit and wallet reversal checks.
Tenant-wallet activation remains blocked by authoritative ownership/actor provisioning.
