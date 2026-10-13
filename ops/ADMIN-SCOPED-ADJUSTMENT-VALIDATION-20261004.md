# Scoped admin adjustment validation

Base freshly fetched origin/main 18a0fa4e5d911952a7993c432a6e7fc50de9e8c5.
Branch fix/admin-scoped-adjustment-validation-20261004. MODULE-MAP read; no
AGENTS.md found. Starter pack and SaaS knowledge base read in earlier stages.
Worktrees/history/remotes/origin branches/open PRs reviewed. Detached Business
generated changes preserved; no foreign or own unmerged implementation imported.
Previous status PR #194 head 3e48bbb passed release gate 1697 and stays separate.

| Function | Existing implementation | Verification | Concrete gap | Next step |
|---|---|---|---|---|
| Sales/Evotor | #174 import/two dashboards; #176 Business cash | Branch/PR inventory | Actual synchronization unavailable | Provider fixture reconciliation |
| CRM/Customer 360 | Main directory, #115, tenant reads #96 | Main tests, draft inventory | Scoped integration disabled | Verify client tenant ownership |
| Corrections | Main route/persistence, #182–184, UI #193, status #194 | Earlier isolated proofs; current actual SQL | Scoped adapter skipped journal kind/status invariant | This fix |
| Telegram campaigns | Main store/retry drafts | Main regression tests | Provider workflow unverified | Isolated transient retry |
| Achievements/frames | Main engine/personal frames, Business grants | Main tests | Scoped grant flow unverified | Audited grant scenario |
| Rights/audit | Main legacy role gates and disabled SaaS foundation | Main tests, #194 isolated tests | Approved memberships/client attribution absent | Trusted scoped executor review |

## Confirmed defect and change

createAdminAdjustmentPersistence validated adjustment/completed only for legacy
INSERT. Scoped mode delegated directly to generic transaction persistence, which
accepts accrue/redeem/shop/etc and arbitrary status. Therefore the adapter's admin
contract was mode-dependent and could write a non-correction/pending journal entry.
Unit and actual SQL regression cases both failed before the fix (missing rejection).

Scoped wrapper now invokes the same normalizeAdjustmentTransaction as legacy mode
before calling generic persistence. Generic writer, attribution, authorization and
legacy SQL/NOW semantics are unchanged. Default gate remains disabled; no runtime
route, migration, dependency or env change. Wrong/null/array inputs, non-adjustment
modes and non-completed statuses fail before SQL. Unknown column validation remains
with the existing generic allowlist. This is a journal invariant, not authorization
or amount validation and not a wallet executor.

Tests use actual main legacy users/wallets/transactions DDL and migration 009 only in
disposable PGlite. Invalid mode/status preserve full users/wallets/journal snapshots;
foreign tenant owner denied before INSERT. Valid credit/debit persist exact mode,
status, actor, reason and tenant/location. Wallet 999 deliberately untouched by this
journal-only adapter. Duplicate request_key raises actual 23505 and leaves two rows;
SQL outage propagates after one attempt without fallback. All source imports from
this main-based branch; no test harness from draft #183 was incorporated.

## Executor review boundaries

Validation: materialized node --test 438/438 (436 main + 2 new regression cases),
canonical focused tests 7/7. Materialize twice tracked/new-file SHA256 identical;
npm run check, VK startup parity, explicit test syntax and git diff --check pass.
Generated runtime changes restored. npm audit exits 1 with main's existing three
moderate qs/body-parser/express findings, tracked separately in #180. Public read-only
probe 2026-10-04T06:04Z (09:04 Moscow) 16/16; deployed main18a0fa4, DB health OK.

Current main route binds staff_id to req.user.id, checks global admin role, locks
request key/client/wallet, compares replay actor/client/mode/amount/reason and uses
legacy persistence. Existing #183 covers isolated financial SQL execution; #194
covers scoped status. These separate drafts are not automatically combined here.
The existing generic scoped writer accepts staff location context and caller actor;
it does not supply admin authorization or client membership. New scoped execution
must check owner/platform rights, bind actor from trusted session, verify client
tenant/location ownership and scope replay evidence before wallet mutation. An
approved membership/client mapping and provisioning contract is still absent.

This fix prevents a future enabled admin adapter from misclassifying journal entries;
it adds no current owner-facing capability. Real signed production workflow, Selectel,
production SQL diagnostic, independent concurrent PostgreSQL and tenant financial
execution remain unverified. UI unchanged; no desktop/mobile claim. No production
data writes, destructive migrations, paid resources, merge or deploy.

Next small stage: establish a read-only client-to-tenant ownership contract from
existing implementations before any scoped financial executor integration.
