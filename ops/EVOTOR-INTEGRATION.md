# Evotor integration draft, 2026-10-06

## Audit and branch boundary

Before edits: fetched origin, reviewed history/open PRs/origin branches and read
`ops/MODULE-MAP.md`. Base main: `18a0fa4e5d911952a7993c432a6e7fc50de9e8c5`.
No production DB/API/device operation, merge or deploy performed.

| Existing work | Reviewed revision | Reused / limitation |
|---|---|---|
| #174, draft/unmerged | `776c70d691540b01bbc56a1496203e6cc918eea6` | Minimal cash snapshots, exact cents, API worker/cursor, migration 012, root panel. Its global/manual projections and unscoped authorization were not retained. |
| #176, draft/unmerged | `2f98f39d687043639d90b99352dcc0b15eb04c81` | Business cash component on pilot branch. Optional `Dashboard.pos` had no backend adapter. Whole Business subtree is absent from main. |
| Evotor bridge | `2f6388a5ba04f8f95758eb31c1dc6ae0cbccdb18` | Receipt UUID state machine retained; staff session replaced. Cached debug signing-key workflow not copied. |
| #201 | `b5a96d732a26564d0aa8087e03475f3c4cffef05` | Read-only diagnostic evidence: 40 SQL / 54 response / 36 HTTP browser cases, simplified transport. Not tenant, hardware or automatic Extras proof. |
| #203 | `7c6c68245ae79c488ad410c16c41eeadf2046391` | Read-only signed-auth/profile recovery evidence (203 cases). Not hardware or complete scope proof. |

Root integration is `feat/evotor-scoped-integration-20261006`, based on current
main. Business delta is separately `feat/evotor-business-integration-20261006`,
stacked on #176 to avoid importing its whole pilot (~150 files) into main.
Neither branch supersedes the approval of the pilot/Business merge chain.
Business shares the exact root POS analytics/repository code rather than a
second money implementation; only read modules are copied into that branch.

## Implemented contracts

- Native device endpoint only: `POST /api/device/pos/qr/resolve`, `Device pvpos_…`.
  Reuses `resolvePersonalQrRecord`, honours revoked QR, excludes deleted/merged
  clients. Returns ID and display first name only. Does not issue a staff session.
- Both `server.js` and `universal-server.js` route to `pos/http.js`; existing
  signed auth stays in place for admin routes. Native device branch precedes
  social/consent requirements; no broad origin exemption was introduced.
- Hash-only random 256-bit device keys, issue/revoke audit in same transaction,
  immediate revocation, one active credential per store/external device ID.
- Explicit binding `tenant_id → location_id → store_id`. For Business these are
  verified `companyId` / `venue.id`, not names or inferred legacy bar IDs.
  Root admin/viewer additionally needs a non-revoked `pos_operator_access` row.
  Management requires admin role AND `can_manage`; a global role is insufficient.
- Business GET `/api/admin/venues/:id/pos?days=30` resolves existing session and
  `resolveVenueScope` first, then exact company/venue binding. Queries run on
  `readPool` in a repeatable-read, read-only transaction. No global store fallback.
- POS defaults OFF (`PIVNIK_POS_ENABLED=false`). Missing schema, unmapped store,
  incomplete first sync and disabled feature produce no cash substitute.
- Two dashboards: default **Все продажи кассы**, **Клиенты приложения**; separate
  **Операции приложения** with “Не являются подтверждённой кассовой выручкой”.
  Business uses the POS endpoint, not manual/staff/bonus totals.
- Loading, successful empty, missing data, sync errors and previous/stale data
  are distinguished. Retry keeps confirmed values with a stale warning for the
  same venue/period. Access denial clears data; venue/period remount discards it.
  Malformed successful JSON is an error, never a zero-cash fallback.

## One monetary source

`gross = SUM(SELL)`; `returns = SUM(PAYBACK)`; `net = gross - returns`.
All, app and anonymous are projections of the same scoped closed documents.
`app.gross <= all.gross`; `app + anonymous = all` within each metric.
App is NOT added to all. Gross split is labelled “до возвратов”; e.g.
300000 total = 110000 app + 190000 anonymous, never 410000.

The current app cohort uses only confirmed administrative links. PAYBACK can
inherit the client ONLY through explicit same-store `base_document_id` → linked
SELL. A PAYBACK's own QR/customer hint is ignored. Unknown fiscal count means
`receiptCount=null`, `averageCents=null`, UI “Нет данных”. Anonymous cash has no
buyer/repeat/frequency metrics. Repeat metrics cover the selected period;
“new customer” is not claimed without complete historical identity data.

Stable unique `(source,store_id,document_id)` prevents duplicate money. Exact
normalized snapshot replay is allowed. A changed snapshot (amount, closing
identity, fiscal count, base receipt, payment/products) conflicts and rolls back
the page/cursor; it is not silently overwritten. This deliberately prefers
review over automatic changes to closed cash data. Manual same-client link retry
preserves original actor/time; another client returns 409. Import/link/device
endpoints never write wallets, bonus transactions or app journal; only the
accrual worker below does, and only from closed cloud documents.

## Automatic bonuses from the till (migration 014)

Redeem/spending at the till is deliberately out of scope.

1. Bartender scans the guest QR into an open sell receipt. Bridge 0.2.0 resolves
   it, then `POST /api/device/pos/receipts/bind` `{receiptUuid, payload}` with the
   device key. The server stores `pos_receipt_claims` (latest scan wins; 409
   `receipt_already_settled` once the receipt was decided for another client).
   The till never sends an amount and writes nothing into the receipt.
2. The worker in `server.js` (child process) runs `syncEvotor` and then
   `processPosBonuses` every `PIVNIK_POS_SYNC_SECONDS` (default 120, min 30).
   It starts only with `PIVNIK_POS_ENABLED=true`, `PIVNIK_POS_BONUS_ENABLED=true`,
   `EVOTOR_API_TOKEN` and `EVOTOR_STORE_ID`, so no separate sync schedule is needed.
3. A closed SELL whose cloud `id` equals a claimed `receiptUuid` accrues once:
   `floor(amountCents × bonusPercent / 10000)` from the guest's current status,
   no status discount (the till charged the full amount). It is a normal
   `accrue` transaction (`staff_id NULL`, request key `evotor:<store>:<doc>`), so
   12-month spend, achievements, Halloween tickets and the Telegram message work
   as for a staff accrual. A claim made more than 15 minutes after close is skipped.
4. A PAYBACK whose `baseDocumentId` is an accrued SELL reverses
   `ceil(earned × returned / sold)`, capped by what that sale earned. A full first
   return cancels the original transaction; otherwise an `adjustment` removes what
   is still on the balance and records the rest as `shortfall`.
5. Every decided document gets one `pos_bonus_accruals` row (applied or skipped
   with a reason), so repeats, restarts and two workers cannot pay twice.

Bind is refused (503) while `PIVNIK_POS_BONUS_ENABLED` is off, so no backlog of
claims builds up. A return on a sale whose accrual an admin already cancelled is
skipped as `base_cancelled`. Tills are rate-limited per device key (120/min) after
the key is checked; failed keys are limited per forwarded client address and never
count against a till.

Bartenders must not also accrue manually in the app for a receipt they scanned.

Unverified until the first real receipt: that the Evotor cloud document `id`
equals the SDK receipt UUID the bridge sends. If it does not, nothing accrues
(claims stay unmatched); check `pos_receipt_claims.receipt_uuid` against
`pos_documents.document_id` for that receipt before changing anything.

## Setup — only after separate staging/production authorization

Do not execute this checklist against production as part of this PR.

1. Take and verify the existing PostgreSQL backup/restore procedure. Review 012,
   additive 013 and additive 014 against the actual target schema. None is a
   startup migration. Apply manually in that order; no drop/truncate.
2. Confirm real Evotor API store ID and Business company/venue IDs. Insert one
   explicit `pos_store_bindings` mapping (initially disabled). Do not infer IDs.
   Grant root operators individually in `pos_operator_access`; Business still
   uses existing venue membership. Least-privileged Business read role needs
   SELECT on POS tables and active user columns; it must remain read-only.
3. Provide server-only `EVOTOR_API_TOKEN`, `EVOTOR_STORE_ID` and explicitly enable
   `PIVNIK_POS_ENABLED` for the intended runtime/store. No browser/device provider
   token. Additional stores use explicit per-worker config via `syncEvotor`, not
   a shared env credential guessed from tenant names. Ingestion is polling, not
   a fabricated webhook. With `PIVNIK_POS_BONUS_ENABLED=true` the server's own
   worker polls; otherwise schedule `node scripts/sync-evotor.mjs` separately.
   Sync resumes pages and repeats a full history scan for late delivery.
4. As consented native admin with scope: POST `/api/admin/pos/devices` with
   `{storeId, externalDeviceId, label}` and existing signed Bearer session.
   Transfer the once-revealed `deviceToken` through an approved private channel
   into a TEST bridge's settings, alongside the HTTPS backend URL. Do not log it.
   GET `/api/admin/pos/devices?storeId=…` lists identifiers without hashes/secrets.
   POST `/api/admin/pos/devices/revoke` with `{id,storeId}` revokes. Lost issue
   response: list→revoke→new issue, never blindly accumulate live credentials.
5. Bridge 1.0.7 (versionCode 11) is built by `.github/workflows/evotor-bridge-apk.yml`
   with a throwaway debug key, so it cannot update the installed 0.1.0 prototype
   in place: uninstall the prototype, install 0.2.0, then enter the URL and key.
   It drops the discount/SetExtra services and adds an Evotor launcher icon for
   the setup screen. A permanent release key is a separate step.
6. Authorize tenant A/B test receipts and prove no cross-company or cross-venue
   read. Review startup parity/static VK bundle and repeat the production release
   gate before agreeing any merge/deploy.

Shortcut for steps 1, 2 and 4 on a single store, after the backup:
`node scripts/evotor-setup.mjs --store <EVOTOR_STORE_ID> --admin <users.id>` checks
and writes nothing; adding `--migrate --apply` applies 012–014, enables the
binding (an existing tenant/location mapping is kept), grants that admin
`can_manage` and prints the till key once. `--reissue` revokes the old key
first. `--admin` can be omitted when `OWNER_TELEGRAM_ID` is set.

Compensation/rollback: disable POS flag and mapping, revoke issued device keys,
stop the import worker and revert the integration application commit. Preserve
POS documents, links and audit records; do not drop tables to roll back. A DB
restore is a separate approved operation requiring the verified backup plan.

## Hard blockers / no fabricated Extras decoder

Need anonymized REAL cloud JSON and corresponding SDK receipt UUID:
SELL with cash and card; linked and no QR; PAYBACK with base ID; cancellation;
two consecutive receipts; repeat/delayed delivery. Establish exact namespace,
key, `pivnik_user_id` value, closed state and fiscal print semantics. Validate SDK
zero-discount behaviour, callback UX, permissions and Keystore on test hardware.
Only then adapt the Extras normalizer and add those exact regression fixtures.
Java writer/SetExtra alone is not evidence of the REST namespace.

Bonus accrual (section above) does not depend on Extras: it matches the till's
receipt UUID to the cloud document id, which still needs one real receipt to confirm.

Until these samples exist, automatic scan→closed cloud document→app cohort is
NOT finished and the Definition of Done is NOT met. Confirmed manual fallback
must be reviewed; it does not stand in for the full installed-cash-register proof.
Do not claim production-ready, or deploy/install this draft.

## Verification evidence and limits

Main baseline: materialized root `node --test`: 436/436 passing. Integration:
see `EVOTOR-VERIFICATION.md` for final counts and commit-specific CI status.
New SQL uses disposable PGlite (PostgreSQL/WASM), not production PostgreSQL.
Advisory lock behaviour is stubbed in worker tests; real concurrency still needs
staging. HTTP tests mount actual checked-out auth/functions/routes on loopback;
Express getProfile has an explicit minimal fixture adapter. They are not a full
production startup proof. Signed sessions, committed response loss/retry, role,
consent and scope are exercised, not just function-source text assertions.

Local browser download failed; desktop/mobile Playwright fixture checks are
added to a dedicated non-deploy CI workflow. JVM/unsigned compilation likewise
runs in CI because local Android SDK/JDK is unavailable. Pending/failed CI is
not considered verified. No live Evotor/API/hardware scenario was exercised.

2026-10-06 `npm audit` root: 6 findings (3 moderate,2 high,1 critical), byte-for-
byte same vulnerability report as pinned main; root lockfile unchanged.
Business: 7 findings (1 moderate,4 high,2 critical), original #176 lockfile
unchanged. Do not hide audit failures or conflate build/test success with release
approval. Dependency remediation is a separate scoped change; current draft
must not pass production gate with high/critical findings unresolved.
