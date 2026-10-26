# CRM beer inventory — 26 October 2026

## Scope and source

Owner's latest request supersedes both earlier cloud intake and remote absolute
inventory proposals. Main baseline `517ea17c4620b843c08b4d01f781c666b41f3548`,
merged PRs309–311; no other active agent or origin inventory branch found.
Work branch `feat/crm-beer-balances-20261026`. Old dirty APK trees are preserved.
The owner separately authorized merge, production migration/deploy and enabling
this function after checks, then requested replacing "Оформление" in the menu.

No Evotor catalog/quantity API calls, no new receipt importer, no real terminal
stock writes, no bonus/payment/wallet changes. The existing recent importer gains
optional non-fiscal observation only. The old concurrency guard and
both old stock flags stay untouched/off. Products HTTP403 is irrelevant to this
read path, which reads existing imported documents, not a cloud product catalog.

## Calculation contract

Exact key: server-authorized company/venue binding → store ID + product ID.
Only position unit `л` and nonnegative integer `quantityMillis` are accepted.
Unknown IDs/quantities/units are visible and never guessed from product names.

`baseline + deliveries - SELL quantities - writeoffs + confirmed physical returns`.
All operands are integer thousandths; projection uses BigInt, serializes strings.
No persisted derived stock or sale-processing cursor. Re-reading the same
immutable receipt collection after restart/recent-sync overlap is deterministic.
All imported store sales count, independently of customer/loyalty attribution.

Initial stock or control count is a physical stock **at server save time**;
closes at/before that timestamp are already included in it. Deduct closes strictly
after it and before displayed report cutoff. A late import is evaluated by
`closed_at`, never `imported_at`. Subsequent manual operations reference that
baseline ID; a new count starts a generation and preserves the complete journal.
Report-time ties include already-recorded manual movements. Concurrent deliveries
append independent rows under a per-product lock; no read-modify-write counter.

A count during an actual physical pour/sale is only as accurate as the owner's
physical measurement/time choice. Separate metadata and receipt databases are
read with independent snapshots, **not distributed atomicity**. A subsequent
refresh includes any late committed receipts. Count audit records the calculation
known at save time and its discrepancy; it is not rewritten if old data arrives.

PAYBACK is shown with `baseDocumentId` but does not automatically restore beer.
An explicitly confirmed physical return needs a real imported refund/product,
cannot exceed its quantity, and has a unique store/product/refund key. A partial
physical return is confirmed once; the operator is told this. Writeoffs require
reason/comment and acknowledgement that no receipt already consumed that beer.

## Authorization, idempotency, history

Existing Admin session/Origin/CSRF/rate-limit/scope routing; service rechecks
active account role, company/venue and owner grant in SQL. Trusted directors
and foreign companies are rejected. SUPER_ADMIN uses an explicit canonical scope.
No browser company/store override, provider URL/token or inferred product IDs.
Same-transaction movement and audit. Canonical payload SHA256 + UUID: exact
retry returns existing operation even after later sales/counts; substitutions
conflict. UI persists a pending command in sessionStorage keyed by actor/company/
venue **before** POST and reuses it after a lost reply/reload. There are no secrets
in that record. One UUID cannot authorize another actor or store.

Reports default to current balance + period sales. Past date/range shows balance
at cutoff, not a sum of daily balances. Past-day UI writes are disabled. Per-product
history includes manual authors/comments/invoice and receipt references; 100-row
pages via `historyOffset`. Quantity limit50k receipts/50k manual rows is explicit:
crossing it fails with BEER_DATA_LIMIT, rather than returning partial balances.

## Reliability and known observation limits

History `pos_sync_state` exposes last_success_at, scan_until, cursor, error. A
completed scan confirms coverage only up to its watermark. No active error and
freshness alone proves nothing beyond it. The actual recent-first worker logs
120s; freshness threshold is three corresponding cycles. Recent two-day scan
success/range/pages previously were not persisted. Optional manual root migration
`026_evotor_recent_sync_status.sql` now adds a separate non-fiscal status table;
the existing importer observes running, complete, incomplete or error after the
receipt transaction. Observation errors are isolated and never prevent receipt
imports or alter history/bonus calculations. A complete fetch persists its exact
two-day range and last-success time; active page/error is reported separately,
retaining the last successful range for inspection. Without that table or a first
observed run, report states `recentSync.state=not_recorded`. A recent range can
prove coverage only if it includes the product baseline and report cutoff. Current
wall-clock balance is normally "Ожидается синхронизация"; historical covered
cutoffs may be current. Known error/unknown positions/negative balance mark
incomplete. No initial point means no balance, not an invented zero.

Before rollout logs also contained `not_installed` from the existing Evotor
worker (25October18:13UTC). This requires actual installation/test-version
verification; do not label all sales current or change APK/bonus settings to hide
it. Earlier portal automation could not load the editor, and a prior edit click
reported the test version left as draft. Do not claim permissions restored.

## Release and rollback

1. Local model, native PostgreSQL16 (two DBs, actual concurrent writers), HTTP
   trusted-director/foreign/CSRF boundaries, desktop/mobile browser fixtures.
2. Materialize twice with byte equality; root tests/check/runtime/VK parity,
   root and Admin full/prod audits; Business build/lint/full tests; exact-head CI.
3. Normal protected PR merge only. Owner CRM is Railway content-nature/admin-pilot,
   not admin staging. Take/verify metadata backup; inspect actual canonical/schema
   before applying **only** additive Admin migration026. Do not run all migrations
   or change automatic startup migration policy. Apply the separate optional POS
   observation migration026 only to the existing receipt database, with SELECT on
   that new table for the existing Admin reader. No financial tables change.
   No initial stock seeded for owner.
4. Set only `ADMIN_ENABLE_BEER_INVENTORY=true` on owner service; global Admin
   writes already gate manual journal operations. Keep Evotor stock flags false.
   Read deployment terminal SUCCESS, health and real authenticated report state.
5. Rollback: set only new flagfalse. Preserve journal, history, schema and backups;
   no destructive SQL or rollback of the cashier/guest service.

Synthetic fixture quantities must never be reported as real bar stock. First
production initial values are the owner's physical measurements, not AI guesses.
