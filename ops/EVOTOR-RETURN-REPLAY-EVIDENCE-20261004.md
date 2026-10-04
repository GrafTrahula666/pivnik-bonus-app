# Existing Evotor return/replay evidence — 2026-10-04

Fresh origin/main: 18a0fa4e5d911952a7993c432a6e7fc50de9e8c5.
New branch test/evotor-return-replay-evidence-20261004 starts directly from main.
Worktrees/remotes/history/origin branches/open PRs inspected; dirty detached
Business copy preserved. Unchanged MODULE-MAP previously read; no AGENTS found.
Starter pack and knowledge base previously read. No unmerged implementation
imported into this branch or startup. Existing #174 pinned at
776c70d691540b01bbc56a1496203e6cc918eea6 passed release gate 1658, VK parity 576
and public observer 243. Separate admin-platform/production-pilot preserved.

| Function | Existing implementation | Verified | Specific gap | Next small step |
|---|---|---|---|---|
| Cash/Evotor | #174 import/repository/analytics | 21 isolated return/replay/period cases here | Real provider document and concurrency absent | Unknown receipt count |
| Dashboards | #174 miniapp; #176 Business cash UI | Prior UI evidence; analytics SQL here | Business venue/store adapter missing | Review existing adapter before wiring |
| CRM/Customer 360 | Main directory; #115/#96 | Prior #196/#197 SQL evidence | History is not wallet ownership | Confirm authoritative binding |
| Bonus corrections | Main route; #193/#199 drafts | Prior actual route/proxy/component proofs | Production scoped actor unverified | Complete trusted identity integration |
| Telegram | Main store and retry drafts | Existing regression suite | Live campaign not tested | Isolated provider retry |
| Achievements/frames | Main engine; Business grants | Existing regression suite | Scoped grants unverified | Audited grant scenario |
| Rights/audit | Legacy roles; disabled scope modules | POS pure role boundary here | Real signed tenant authorization absent | Validate approved memberships |

## Selected bounded scenario

No new importer/dashboard implementation. A manual verifier reads ten pinned
source/DDL/fixture files from local git into a disposable directory, prints their
SHA256 hashes and deletes the directory after the run. No automatic fetch/fallback.
Run: node scripts/verify-evotor-return-replay.mjs. Requires the pinned git object
and already-declared PGlite dependency; no new dependencies or configuration.

Actual #174 normalization, page import, customer link, period, SQL read, analytics,
role boundary and sync functions execute on isolated PGlite. Fixture users/QR,
wallets and empty legacy journal are synthetic. Actual migration 012 runs only
inside that disposable in-memory DB. Provider fetch is injected; advisory lock/
unlock are stubbed because PGlite lacks those functions. No production startup,
provider request or tenant ownership claim.

Sixteen cases pass before/after materialization: early refund negative/anonymous;
refund replay; late sale; explicit QR link retrospectively attributes its return;
repeated sale/refund retain totals/link; anonymous same-amount sale excluded from
loyalty; no-base refund excluded; foreign-store base excluded; partial plus remaining
refund nets linked sale to zero; full replay preserves financial document projection;
deleted customer loses attribution but cash remains; invalid page rolls documents/
cursor back; fractional-cent input denied; role denied; conflicting relink denied;
provider outage preserves totals and last successful sync. Full wallet/journal
snapshots stay unchanged after every case. No regression reproduced in this scope.

Upsert may refresh imported_at/sync timestamps even for replay; the proof compares
financial document projection, not byte-identical database rows. Direct SQL role/
function tests do not exercise signed HTTP authentication or the public dispatcher.
No new production feature is delivered: this is evidence for the already-existing,
disabled importer, helping avoid overstated sales and attribution assumptions.

## Metric contract exercised

Source: normalized closed SELL/PAYBACK documents from the pinned fixture format.
Identity: source/store/document ID; repeats upsert one row. All cash sums SELL,
subtracts PAYBACK on its own closed date, and includes anonymous sales. Loyalty
includes explicitly linked sales and returns whose explicit baseDocumentId matches
an eligible linked sale in the same store. Names/phones/amount matching are ignored.

Period: 2026-10-02 Moscow, [2026-10-01T21:00Z, 2026-10-02T21:00Z).
Gross sales/returns/net are integer kopecks. Receipt count sums known sale prints;
returns do not add sale receipts. Average = gross sales / sale receipts, rounded
half-up; it is not net revenue divided by receipts. Active/repeat buyers count sale
participation, so a fully refunded purchaser may remain a buyer. This evidence does
not validate real fiscal print shape, count uniqueness or marketing attribution.

## Verification and limits

Materialize twice: identical SHA256 across 394 tracked/new files present then.
Initial node --test: 427 passed, 9 failed in existing VK client/source assertions.
After materialization recheck, standalone node --test passed 436/436. Cause of the
initial failures not established; no VK changes/fixes claimed. app.js SHA256 equals
previous successful materialized #199 verification. Follow-up failure evidence kept
separate from this POS scenario. npm run check, manual syntax, VK startup parity and
diff-check passed. No patch retirement; generated runtime files restored.

npm audit retains three existing moderate findings (#180). Public read-only probe
16/16 at 2026-10-04T16:09:09+00:00. No production SQL inspection, real receipt sync,
model/API onboarding, signed owner flow, independent PostgreSQL lock/contention or
provider delay proof. UI unchanged, no desktop/mobile UX claim from this stage.
No real data/config/schema/dependency changes, paid resources, merge or deploy.

Next small stage: linked sale and return on different Moscow dates, proving the
return period uses its close date while client attribution can use an out-of-period
base sale. Real provider onboarding remains blocked by verified anonymized receipts
and authorized token/store configuration.

## Cross-period follow-up

Fresh origin/main remains 18a0fa4e5d911952a7993c432a6e7fc50de9e8c5; prior
#201 release gate 1713 passed. No AGENTS found; MODULE-MAP unchanged/read.
Five additional cases execute actual pinned SQL and analytics in a separate
synthetic store: return arrives before its out-of-period sale; sale at
2026-10-02T20:59:59.999Z belongs to October 2 Moscow; return at
2026-10-02T21:00:00.000Z belongs to October 3 Moscow; later explicit QR link
attributes that return even though its base is outside the selected period;
combined interval reconciles both days; repeated import preserves each day's
metrics and financial document projection. (The boundary and attribution
assertions are grouped into five checks.) All 21 checks pass on canonical and
materialized trees; every check preserves synthetic wallets and legacy journal.

October 2: sales/net 1000 kopecks, returns 0, one receipt, average 1000.
October 3: sales 0, returns 300, net -300, no sale receipts, average null,
active buyers 0 and linked revenue share null. Combined October 2–3: net 700,
one active buyer, no repeat buyer. Return identity does not imply a new purchase.

Follow-up validation: 436/436 node tests, npm check and manual syntax passed.
Two materializations produced identical SHA256 for 395 tracked files. The first
hash inventory attempt failed because git quoted non-ASCII filenames; rerun used
NUL-delimited paths and completed successfully. No code regression caused by this
verification helper. npm audit still reports three existing moderate findings.
Production routes and UI unchanged; no desktop/mobile claim. No new regression
reproduced; production readiness, provider fiscal shape, signed tenant authorization
and independent PostgreSQL locking remain unverified as above.

Next bounded evidence stage: unknown fiscal receipt count must keep average null
instead of showing a fabricated zero or dividing by a partial receipt count.
